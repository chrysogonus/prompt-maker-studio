"""Application composition and startup lifecycle."""

from contextlib import asynccontextmanager
import os

from fastapi import FastAPI

from app.api.admin_routes import router as admin_router
from app.api.auth_routes import router as auth_router
from app.api.eval_routes import router as eval_router
from app.api.mcp_routes import MCP_PATH, PROTECTED_RESOURCE_METADATA_PATH, mcp_endpoint
from app.api.oauth_routes import oauth_protocol_app, well_known_router
from app.api.oauth_routes import router as oauth_router
from app.api.refine_routes import router as refine_router
from app.api.routes import router
from app.auth.utils import SECRET_KEY, is_insecure_secret_key
from app.branding import APP_NAME
from app.database.connection import Base, engine
from app.database.migrations import run_migrations
from app.http import configure_http


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


def root():
    """Health check endpoint."""
    return {"status": "healthy", "service": f"{APP_NAME} API"}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.getenv("TESTING") != "true":
        enforce_secret_key_policy()
        init_db()
    async with mcp_endpoint.lifespan():
        yield


def create_app() -> FastAPI:
    application = FastAPI(
        title=f"{APP_NAME} API",
        description="API for generating structured prompts",
        version="0.7.0",
        lifespan=lifespan,
    )
    configure_http(application)
    for routes in (
        auth_router,
        router,
        admin_router,
        eval_router,
        refine_router,
        oauth_router,
        well_known_router,
    ):
        application.include_router(routes)
    # Consent routes must precede the OAuth protocol mount.
    application.mount("/api/oauth", oauth_protocol_app)
    application.add_route(MCP_PATH, mcp_endpoint, include_in_schema=False)
    application.add_route(PROTECTED_RESOURCE_METADATA_PATH, mcp_endpoint, include_in_schema=False)
    application.get("/")(root)
    return application


app = create_app()
