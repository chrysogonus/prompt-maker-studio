"""HTTP middleware, instrumentation and public error responses."""

import gzip
import logging
import os
from time import perf_counter
import uuid

from fastapi import Depends, FastAPI, Request, status
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    CollectorRegistry,
    generate_latest,
    multiprocess,
)
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.auth.cookies import CSRF_HEADER_NAME
from app.database.connection import get_db
from app.limiter import limiter
from app.metrics import channel_context, refresh_snapshot, request_id_context
from app.services.budget_service import BudgetExceededError

logger = logging.getLogger(__name__)


class RequestIdMiddleware:
    """Attach a correlation id to every HTTP request and response.

    This is a pure ASGI middleware rather than ``BaseHTTPMiddleware``. The
    latter coordinates request handling through AnyIO memory streams and can
    deadlock with the Starlette/AnyIO versions supported by this project.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        channel = (
            "mcp"
            if scope["path"] == "/api/mcp" or scope["path"].startswith("/api/mcp/")
            else "rest"
        )
        scope["state"]["channel"] = channel
        request_token = request_id_context.set(request_id)
        channel_token = channel_context.set(channel)
        started = perf_counter()
        status_code = 500
        error_type = "none"

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                message["headers"] = [
                    *message.get("headers", []),
                    (b"x-request-id", request_id.encode("ascii")),
                ]
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            error_type = "internal"
            raise
        finally:
            try:
                if scope["path"] not in {"/", "/metrics"}:
                    method = scope["method"]
                    logger.info(
                        "http_request",
                        extra={
                            "event": "http_request",
                            "request_id": request_id,
                            "channel": channel,
                            "method": method
                            if method
                            in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
                            else "OTHER",
                            "route": getattr(scope.get("route"), "path", None),
                            "status_code": status_code,
                            "duration_seconds": perf_counter() - started,
                            "outcome": "error"
                            if status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR
                            or error_type != "none"
                            else (
                                "rejected"
                                if status_code >= status.HTTP_400_BAD_REQUEST
                                else "success"
                            ),
                            "error_type": error_type,
                        },
                    )
            finally:
                channel_context.reset(channel_token)
                request_id_context.reset(request_token)


async def unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all for anything not already handled by a more specific handler
    (HTTPException, RequestValidationError). Previously these fell through to
    Starlette's bare default 500 with no way to correlate the failure to a
    server-side log entry."""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.error(
        "unhandled_exception",
        exc_info=(type(exc), exc, exc.__traceback__),
        extra={
            "event": "unhandled_exception",
            "request_id": request_id,
            "channel": getattr(request.state, "channel", "rest"),
            "outcome": "error",
            "error_type": "internal",
        },
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "An unexpected error occurred. Please try again.",
            "request_id": request_id,
        },
        # RequestIdMiddleware's header-setting code doesn't run for this path:
        # the exception unwinds to ServerErrorMiddleware, which invokes this
        # handler directly, so the error response needs the header here too.
        headers={"X-Request-ID": request_id},
    )


def _plain_message(error: dict) -> str:
    """Pydantic's message without wording people cannot act on."""
    message = str(error.get("msg", ""))
    loc = error.get("loc") or ()
    # email-validator explains DNS and special-use domains (".test"); the person needs only this.
    if loc and loc[-1] == "email" and message.startswith("value is not a valid email address"):
        return "Enter an email address you can receive mail at."
    # A validator's own ValueError text is already written for people.
    return message.removeprefix("Value error, ")


async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    errors = exc.errors()
    error_types = sorted({str(error.get("type", "unknown")) for error in errors})
    logger.warning(
        "Request validation error: count=%d types=%s",
        len(errors),
        error_types,
        extra={
            "event": "request_validation",
            "outcome": "rejected",
            "error_type": "validation",
            "validation_error_types": error_types,
            "validation_error_count": len(errors),
        },
    )

    for error in errors:
        if error.get("type") == "value_error" and "Field names must be unique" in error.get(
            "msg", ""
        ):
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "detail": "Field Duplication Error: You cannot have two fields with the exact same name."
                },
            )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": [
                {"loc": e["loc"], "msg": _plain_message(e), "type": e["type"]} for e in errors
            ]
        },
    )


def metrics_endpoint(request: Request, db: Session = Depends(get_db)) -> Response:
    """Refresh cached app totals and retain the existing Prometheus exposition."""
    refresh_snapshot(db)
    registry = REGISTRY
    if "PROMETHEUS_MULTIPROC_DIR" in os.environ:
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
    content = generate_latest(registry)
    headers = {"Content-Type": CONTENT_TYPE_LATEST}
    if "gzip" in request.headers.get("Accept-Encoding", ""):
        content = gzip.compress(content)
        headers["Content-Encoding"] = "gzip"
    return Response(content=content, headers=headers)


async def budget_exception_handler(request: Request, exc: HTTPException):
    """Keep the legacy message while adding recovery data to budget rejections."""
    cause = exc.__cause__
    while cause is not None:
        if isinstance(cause, BudgetExceededError) and cause.budget is not None:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "budget": cause.budget},
                headers={**(exc.headers or {}), "Retry-After": str(cause.budget["retry_after"])},
            )
        cause = cause.__cause__
    return await http_exception_handler(request, exc)


def configure_http(app: FastAPI) -> None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    Instrumentator(
        should_group_status_codes=False, excluded_handlers=["^/$", "^/metrics$"]
    ).instrument(app)
    app.get("/metrics", include_in_schema=False)(metrics_endpoint)
    app.add_middleware(RequestIdMiddleware)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.add_exception_handler(HTTPException, budget_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", CSRF_HEADER_NAME],
    )
