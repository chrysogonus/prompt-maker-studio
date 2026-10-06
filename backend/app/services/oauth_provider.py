"""
OAuth 2.1 authorization server for MCP clients such as ChatGPT.

The MCP SDK implements the protocol endpoints (metadata, /authorize, /token,
/register, /revoke) and calls into `OAuthProvider` for storage and decisions.
The one step the SDK cannot do is the user's sign-in and consent: /authorize
hands off to the frontend's /oauth/authorize page with the validated request
signed into a short-lived JWT, and `approve_authorization` finishes the flow
once the signed-in user approves.

Access tokens are JWTs signed like session tokens but bound to the MCP
endpoint through their `aud` claim. The session decoder rejects any token with
an audience, so an access token issued to ChatGPT cannot call the REST API.
Both access and refresh tokens carry the user's `token_version`, so a password
change, reset, or "sign out everywhere" disconnects MCP clients too.
"""

from datetime import UTC, datetime, timedelta
import logging
import os
import secrets
from urllib.parse import urlparse

import anyio.to_thread
import jwt
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy.orm import Session

from app.auth.utils import (
    _JWT_CLOCK_SKEW_SECONDS,
    ALGORITHM,
    SECRET_KEY,
    hash_password_reset_token,
)
from app.database.connection import SessionLocal
from app.models.oauth import OAuthAuthorizationCode, OAuthClient, OAuthRefreshToken
from app.models.user import User
from app.services.optimistic_concurrency import as_utc

logger = logging.getLogger(__name__)

# The site's public origin. Caddy serves frontend and API on one origin, so the
# same variable that builds password-reset links names the OAuth URLs too.
PUBLIC_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
ISSUER_URL = f"{PUBLIC_URL}/api/oauth"
RESOURCE_URL = f"{PUBLIC_URL}/api/mcp"

ACCESS_TOKEN_LIFETIME = timedelta(hours=1)
REFRESH_TOKEN_LIFETIME = timedelta(days=30)
AUTHORIZATION_CODE_LIFETIME = timedelta(minutes=5)
# How long the user has to sign in and approve on the consent page.
AUTHORIZATION_REQUEST_LIFETIME = timedelta(minutes=15)

_REQUEST_AUDIENCE = "oauth-authorization-request"
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def allowed_redirect_hosts() -> set[str]:
    """Hosts a client may register as a redirect target, besides loopback.

    Registration is open to any client (that is what dynamic registration is
    for), so this is what stops a look-alike app from using the consent page to
    send a user's authorization to a host it controls.
    """
    raw = os.getenv("OAUTH_REDIRECT_HOSTS", "chatgpt.com")
    return {host.strip().lower() for host in raw.split(",") if host.strip()}


def _redirect_uri_allowed(uri: str) -> bool:
    parsed = urlparse(uri)
    host = (parsed.hostname or "").lower()
    if host in _LOOPBACK_HOSTS:
        # Local tools such as the MCP Inspector. A code sent to loopback only
        # ever reaches the user's own machine.
        return parsed.scheme in ("http", "https")
    return parsed.scheme == "https" and host in allowed_redirect_hosts()


def _hash(value: str) -> str:
    return hash_password_reset_token(value)


def _now() -> datetime:
    return datetime.now(UTC)


def _same_resource(resource: str | None) -> bool:
    return resource is None or resource.rstrip("/") == RESOURCE_URL


def create_mcp_access_token(user: User, client_id: str) -> str:
    now = _now()
    payload = {
        "sub": user.username,
        "aud": RESOURCE_URL,
        "client_id": client_id,
        "tv": user.token_version or 0,
        "iat": now,
        "exp": now + ACCESS_TOKEN_LIFETIME,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def user_from_mcp_access_token(token: str, db: Session) -> tuple[User, dict] | None:
    """Resolve an access token issued by this server for the MCP endpoint."""
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            audience=RESOURCE_URL,
            leeway=_JWT_CLOCK_SKEW_SECONDS,
        )
    except jwt.PyJWTError:
        return None
    user = db.query(User).filter(User.username == payload.get("sub")).first()
    if user is None or payload.get("tv", 0) != (user.token_version or 0):
        return None
    return user, payload


def decode_authorization_request(signed: str) -> dict | None:
    """The authorization request /authorize handed to the consent page, if
    the signature and expiry check out."""
    try:
        return jwt.decode(signed, SECRET_KEY, algorithms=[ALGORITHM], audience=_REQUEST_AUDIENCE)
    except jwt.PyJWTError:
        return None


def get_client_info(db: Session, client_id: str) -> OAuthClientInformationFull | None:
    row = db.get(OAuthClient, client_id)
    return OAuthClientInformationFull.model_validate_json(row.client_info) if row else None


def approve_authorization(db: Session, request: dict, user: User) -> str:
    """Issue a one-time code for an approved request; return the client redirect."""
    code = secrets.token_urlsafe(32)
    db.add(
        OAuthAuthorizationCode(
            code_hash=_hash(code),
            client_id=request["client_id"],
            user_id=user.id,
            redirect_uri=request["redirect_uri"],
            redirect_uri_provided_explicitly=request["redirect_uri_provided_explicitly"],
            code_challenge=request["code_challenge"],
            scopes=request["scopes"],
            resource=request["resource"],
            expires_at=_now() + AUTHORIZATION_CODE_LIFETIME,
        )
    )
    db.commit()
    return construct_redirect_uri(request["redirect_uri"], code=code, state=request["state"])


def deny_authorization(request: dict) -> str:
    return construct_redirect_uri(
        request["redirect_uri"],
        error="access_denied",
        error_description="The user declined the request",
        state=request["state"],
    )


class OAuthProvider:
    """Storage and decisions behind the MCP SDK's OAuth endpoints.

    The SDK's handlers are async; every method here runs its database work in
    a worker thread so the synchronous SQLAlchemy session never blocks the
    event loop.
    """

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return await anyio.to_thread.run_sync(self._get_client, client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        for uri in client_info.redirect_uris or []:
            if not _redirect_uri_allowed(str(uri)):
                raise RegistrationError(
                    error="invalid_redirect_uri",
                    error_description=f"Redirect URI not allowed: {uri}",
                )
        await anyio.to_thread.run_sync(self._store_client, client_info)

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        if not _same_resource(params.resource):
            raise AuthorizeError(
                error="invalid_request",
                error_description=f"Unknown resource; this server issues tokens for {RESOURCE_URL}",
            )
        now = _now()
        signed = jwt.encode(
            {
                "aud": _REQUEST_AUDIENCE,
                "iat": now,
                "exp": now + AUTHORIZATION_REQUEST_LIFETIME,
                "client_id": client.client_id,
                "redirect_uri": str(params.redirect_uri),
                "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
                "code_challenge": params.code_challenge,
                "state": params.state,
                "scopes": params.scopes or [],
                "resource": params.resource,
            },
            SECRET_KEY,
            algorithm=ALGORITHM,
        )
        return construct_redirect_uri(f"{PUBLIC_URL}/oauth/authorize", request=signed)

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        return await anyio.to_thread.run_sync(self._load_code, client.client_id, authorization_code)

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        return await anyio.to_thread.run_sync(self._exchange_code, client, authorization_code)

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        return await anyio.to_thread.run_sync(self._load_refresh, client.client_id, refresh_token)

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        return await anyio.to_thread.run_sync(self._rotate_refresh, client, refresh_token, scopes)

    async def load_access_token(self, token: str) -> AccessToken | None:
        # The MCP endpoint verifies tokens itself (see mcp_routes); this is
        # only consulted by the SDK's revocation handler.
        return await anyio.to_thread.run_sync(self._load_access, token)

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        # Access tokens are stateless and expire within the hour; revoking one
        # ends the client's connection by dropping its refresh tokens instead.
        await anyio.to_thread.run_sync(self._revoke, token)

    # --- synchronous database work -------------------------------------------------

    def _get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        with SessionLocal() as db:
            return get_client_info(db, client_id)

    def _store_client(self, client_info: OAuthClientInformationFull) -> None:
        with SessionLocal() as db:
            db.add(
                OAuthClient(
                    client_id=client_info.client_id,
                    client_info=client_info.model_dump_json(),
                )
            )
            db.commit()

    def _load_code(self, client_id: str, code: str) -> AuthorizationCode | None:
        with SessionLocal() as db:
            row = db.get(OAuthAuthorizationCode, _hash(code))
            if row is None or row.client_id != client_id:
                return None
            return AuthorizationCode(
                code=code,
                scopes=row.scopes,
                expires_at=as_utc(row.expires_at).timestamp(),
                client_id=row.client_id,
                code_challenge=row.code_challenge,
                redirect_uri=row.redirect_uri,
                redirect_uri_provided_explicitly=row.redirect_uri_provided_explicitly,
                resource=row.resource,
                subject=str(row.user_id),
            )

    def _exchange_code(
        self, client: OAuthClientInformationFull, code: AuthorizationCode
    ) -> OAuthToken:
        with SessionLocal() as db:
            # Deleting is what makes the code single-use; a second exchange of
            # the same code finds nothing to delete.
            deleted = (
                db.query(OAuthAuthorizationCode)
                .filter(OAuthAuthorizationCode.code_hash == _hash(code.code))
                .delete()
            )
            user = db.get(User, int(code.subject))
            if not deleted or user is None:
                db.rollback()
                raise TokenError(error="invalid_grant", error_description="Code already used")
            return self._issue_tokens(db, user, client.client_id, code.scopes, code.resource)

    def _load_refresh(self, client_id: str, token: str) -> RefreshToken | None:
        with SessionLocal() as db:
            row = db.get(OAuthRefreshToken, _hash(token))
            if row is None or row.client_id != client_id or row.user is None:
                return None
            if row.token_version != (row.user.token_version or 0):
                return None
            return RefreshToken(
                token=token,
                client_id=row.client_id,
                scopes=row.scopes,
                expires_at=int(as_utc(row.expires_at).timestamp()),
                resource=row.resource,
                subject=str(row.user_id),
            )

    def _rotate_refresh(
        self, client: OAuthClientInformationFull, refresh: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        with SessionLocal() as db:
            deleted = (
                db.query(OAuthRefreshToken)
                .filter(OAuthRefreshToken.token_hash == _hash(refresh.token))
                .delete()
            )
            user = db.get(User, int(refresh.subject))
            if not deleted or user is None:
                db.rollback()
                raise TokenError(
                    error="invalid_grant", error_description="Refresh token already used"
                )
            return self._issue_tokens(
                db, user, client.client_id, scopes or refresh.scopes, refresh.resource
            )

    def _issue_tokens(
        self,
        db: Session,
        user: User,
        client_id: str,
        scopes: list[str],
        resource: str | None,
    ) -> OAuthToken:
        refresh = secrets.token_urlsafe(32)
        db.add(
            OAuthRefreshToken(
                token_hash=_hash(refresh),
                client_id=client_id,
                user_id=user.id,
                scopes=scopes,
                resource=resource,
                token_version=user.token_version or 0,
                expires_at=_now() + REFRESH_TOKEN_LIFETIME,
            )
        )
        db.commit()
        return OAuthToken(
            access_token=create_mcp_access_token(user, client_id),
            token_type="Bearer",
            expires_in=int(ACCESS_TOKEN_LIFETIME.total_seconds()),
            refresh_token=refresh,
            scope=" ".join(scopes) or None,
        )

    def _load_access(self, token: str) -> AccessToken | None:
        with SessionLocal() as db:
            resolved = user_from_mcp_access_token(token, db)
            if resolved is None:
                return None
            user, payload = resolved
            return AccessToken(
                token=token,
                client_id=payload["client_id"],
                scopes=[],
                expires_at=payload["exp"],
                resource=RESOURCE_URL,
                subject=str(user.id),
            )

    def _revoke(self, token: AccessToken | RefreshToken) -> None:
        with SessionLocal() as db:
            query = db.query(OAuthRefreshToken)
            if isinstance(token, RefreshToken):
                query = query.filter(OAuthRefreshToken.token_hash == _hash(token.token))
            else:
                query = query.filter(
                    OAuthRefreshToken.client_id == token.client_id,
                    OAuthRefreshToken.user_id == int(token.subject),
                )
            query.delete()
            db.commit()
