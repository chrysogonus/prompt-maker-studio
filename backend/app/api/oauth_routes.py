"""
OAuth endpoints that let MCP clients such as ChatGPT link to a user's account.

The protocol endpoints themselves (/register, /authorize, /token, /revoke) are
the MCP SDK's, mounted under /api/oauth by `oauth_protocol_app`. This module
adds what the SDK leaves to the application: the consent step the frontend's
/oauth/authorize page drives, and authorization-server metadata at the
RFC 8414 location for an issuer with a path.
"""

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from mcp.server.auth.routes import build_metadata, create_auth_routes
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from pydantic import AnyHttpUrl, BaseModel
from sqlalchemy.orm import Session
from starlette.applications import Starlette

from app.auth.dependencies import get_current_user
from app.database.connection import get_db
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
_REGISTRATION = ClientRegistrationOptions(enabled=True)
_REVOCATION = RevocationOptions(enabled=True)

# Mounted at /api/oauth in main.py, after `router`, so /api/oauth/consent
# resolves to the routes below rather than into this app.
oauth_protocol_app = Starlette(
    routes=create_auth_routes(
        OAuthProvider(),
        issuer_url=_ISSUER,
        client_registration_options=_REGISTRATION,
        revocation_options=_REVOCATION,
    )
)

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
def get_consent_details(
    request: str = Query(..., max_length=4096),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Describe a pending authorization request for the consent screen."""
    pending, client_name = _pending_request(request, db)
    return ConsentDetails(
        client_name=client_name, redirect_host=urlparse(pending["redirect_uri"]).hostname or ""
    )


@router.post("/consent", response_model=ConsentResult)
def decide_consent(
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
