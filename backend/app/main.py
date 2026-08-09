"""
FastAPI application entry point.
Configures CORS, database, and routes.
"""

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

from app.api.admin_routes import router as admin_router
from app.api.analytics_routes import router as analytics_router
from app.api.auth_routes import router as auth_router
from app.api.eval_routes import router as eval_router
from app.api.refine_routes import router as refine_router
from app.api.routes import router
from app.auth.cookies import CSRF_HEADER_NAME
from app.auth.utils import SECRET_KEY, is_insecure_secret_key
from app.branding import APP_NAME
from app.database.connection import Base, engine
from app.database.migrations import run_migrations
from app.limiter import limiter

logger = logging.getLogger(__name__)

app = FastAPI(
    title=f"{APP_NAME} API", description="API for generating structured prompts", version="0.1.0"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Instrument FastAPI application for metrics
Instrumentator().instrument(app).expose(app, include_in_schema=False, should_gzip=True)


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


app.add_middleware(RequestIdMiddleware)


@app.exception_handler(Exception)
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


@app.exception_handler(RequestValidationError)
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


def init_db():
    """Initialize database tables."""
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)


def enforce_secret_key_policy():
    """Refuse to start when the JWT signing key is one anyone could guess.

    Raises:
        RuntimeError: if `SECRET_KEY` is a published example value, unset, or
            too short. Failing here is deliberate — an instance that boots with
            a public key looks healthy while every session token on it is
            forgeable.
    """
    if is_insecure_secret_key(SECRET_KEY):
        msg = (
            "SECRET_KEY is unset, too short, or still set to a published example value. "
            "Anyone could forge session tokens against this instance. "
            "Set SECRET_KEY to a strong random secret before starting the server. "
            "Generate one with: openssl rand -hex 32"
        )
        raise RuntimeError(msg)


# Create database tables (skip in test environment)
if os.getenv("TESTING") != "true":
    init_db()
    enforce_secret_key_policy()

# Configure CORS
origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # Required only for an explicitly cross-origin frontend/API topology. The
    # default Caddy and Next-proxy paths are same-origin.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", CSRF_HEADER_NAME],
)

# Include routes
app.include_router(auth_router)
app.include_router(router)
app.include_router(admin_router)
app.include_router(analytics_router)
app.include_router(eval_router)
app.include_router(refine_router)


@app.get("/")
def root():
    """Health check endpoint."""
    return {"status": "healthy", "service": f"{APP_NAME} API"}
