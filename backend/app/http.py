"""HTTP middleware, instrumentation and public error responses."""

import logging
import os
import uuid

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.auth.cookies import CSRF_HEADER_NAME
from app.limiter import limiter

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

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [
                    *message.get("headers", []),
                    (b"x-request-id", request_id.encode("ascii")),
                ]
            await send(message)

        await self.app(scope, receive, send_with_request_id)


async def unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all for anything not already handled by a more specific handler
    (HTTPException, RequestValidationError). Previously these fell through to
    Starlette's bare default 500 with no way to correlate the failure to a
    server-side log entry."""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception(
        "Unhandled %s on %s %s [request_id=%s]",
        type(exc).__name__,
        request.method,
        request.url.path,
        request_id,
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


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    error_types = sorted({str(error.get("type", "unknown")) for error in errors})
    logger.warning(
        "Request validation error on %s %s: count=%d types=%s",
        request.method,
        request.url.path,
        len(errors),
        error_types,
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
        content={"detail": [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in errors]},
    )


def configure_http(app: FastAPI) -> None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    Instrumentator().instrument(app).expose(app, include_in_schema=False, should_gzip=True)
    app.add_middleware(RequestIdMiddleware)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", CSRF_HEADER_NAME],
    )
