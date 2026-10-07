"""
OAuth endpoints that let MCP clients such as ChatGPT link to a user's account.

The protocol endpoints themselves (/register, /authorize, /token, /revoke) are
the MCP SDK's, mounted under /api/oauth by `oauth_protocol_app`. This module
adds what the SDK leaves to the application: the consent step the frontend's
/oauth/authorize page drives, and authorization-server metadata at the
RFC 8414 location for an issuer with a path.
"""

import os
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from limits import RateLimitItem, parse
from mcp.server.auth.routes import build_metadata, create_auth_routes
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from pydantic import AnyHttpUrl, BaseModel
from sqlalchemy.orm import Session
from starlette.applications import Starlette
from starlette.requests import Request as StarletteRequest
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.limiter import _rate_limit_key, limiter
from app.models.user import User
from app.services.oauth_provider import (
    ISSUER_URL,
    OAuthProvider,
    approve_authorization,
    decode_authorization_request,
    deny_authorization,
    get_client_info,
)

router = APIRouter(prefix="/api/oauth", tags=["oauth"])

_ISSUER = AnyHttpUrl(ISSUER_URL)
# offline_access is the only scope. Refresh tokens are issued regardless; it is
# advertised because ChatGPT looks for it in scopes_supported before relying on
# refresh tokens, and without them users would reconnect every hour.
_REGISTRATION = ClientRegistrationOptions(
    enabled=True, valid_scopes=["offline_access"], default_scopes=["offline_access"]
)
_REVOCATION = RevocationOptions(enabled=True)

# Per client address, like every other limit in the API. ChatGPT calls these
# from OpenAI's servers, whose addresses all of its users share, so they are
# looser than the browser-facing register/login limits and can be raised.
_TOKEN_RATE_LIMIT = os.getenv("OAUTH_TOKEN_RATE_LIMIT", "60/minute")
_PROTOCOL_RATE_LIMITS = {
    "/register": os.getenv("OAUTH_REGISTER_RATE_LIMIT", "20/minute"),
    "/token": _TOKEN_RATE_LIMIT,
    "/revoke": _TOKEN_RATE_LIMIT,
}


class _RateLimited:
    """Apply the shared limiter to one of the SDK's endpoints.

    They are plain Starlette routes, so slowapi's route decorator cannot reach
    them; this checks the same limiter storage with the same per-client key.
    """

    def __init__(self, app: ASGIApp, path: str, limit: RateLimitItem) -> None:
        self.app = app
        self.path = path
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        key = _rate_limit_key(StarletteRequest(scope))
        if not limiter.limiter.hit(self.limit, "oauth", self.path, key):
            response = JSONResponse(
                {"error": f"Rate limit exceeded: {self.limit}"}, status_code=429
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _protocol_routes():
    routes = create_auth_routes(
        OAuthProvider(),
        issuer_url=_ISSUER,
        client_registration_options=_REGISTRATION,
        revocation_options=_REVOCATION,
    )
    for route in routes:
        if route.path in _PROTOCOL_RATE_LIMITS:
            limit = parse(_PROTOCOL_RATE_LIMITS[route.path])
            route.app = _RateLimited(route.app, route.path, limit)
    return routes


# Mounted at /api/oauth in main.py, after `router`, so /api/oauth/consent
# resolves to the routes below rather than into this app.
oauth_protocol_app = Starlette(routes=_protocol_routes())

well_known_router = APIRouter(include_in_schema=False)


@well_known_router.get("/.well-known/oauth-authorization-server/api/oauth")
def authorization_server_metadata() -> dict:
    """RFC 8414 metadata. For an issuer with a path, clients look it up at the
    well-known prefix followed by that path."""
    metadata = build_metadata(_ISSUER, None, _REGISTRATION, _REVOCATION)
    return metadata.model_dump(mode="json", exclude_none=True)


class ConsentDetails(BaseModel):
    client_name: str
    redirect_host: str


class ConsentDecision(BaseModel):
    request: str
    approve: bool


class ConsentResult(BaseModel):
    redirect_url: str


def _pending_request(signed: str, db: Session) -> tuple[dict, str]:
    request = decode_authorization_request(signed)
    client = get_client_info(db, request["client_id"]) if request else None
    if request is None or client is None:
        raise HTTPException(
            status_code=400,
            detail="This connection request has expired or is invalid. Start again from the app.",
        )
    return request, client.client_name or "An application"


@router.get("/consent", response_model=ConsentDetails)
@limiter.limit("30/minute")
def get_consent_details(
    request: Request,
    signed_request: str = Query(..., alias="request", max_length=4096),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Describe a pending authorization request for the consent screen."""
    pending, client_name = _pending_request(signed_request, db)
    return ConsentDetails(
        client_name=client_name, redirect_host=urlparse(pending["redirect_uri"]).hostname or ""
    )


@router.post("/consent", response_model=ConsentResult)
@limiter.limit("10/minute")
def decide_consent(
    request: Request,
    body: ConsentDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve or deny a pending authorization request as the signed-in user.

    Returns the client redirect for the browser to follow: with a one-time
    code on approval, with `error=access_denied` otherwise.
    """
    pending, _ = _pending_request(body.request, db)
    if body.approve:
        return ConsentResult(redirect_url=approve_authorization(db, pending, current_user))
    return ConsentResult(redirect_url=deny_authorization(pending))
