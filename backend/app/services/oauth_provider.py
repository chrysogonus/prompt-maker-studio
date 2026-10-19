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
Codes and tokens carry the user's `token_version`, so a password change,
reset, or "sign out everywhere" also invalidates pending approvals. A persisted
account/client grant version makes client revocation effective on every request.
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
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.utils import (
    _JWT_CLOCK_SKEW_SECONDS,
    ALGORITHM,
    SECRET_KEY,
    hash_password_reset_token,
)
from app.database.connection import SessionLocal
from app.models.oauth import OAuthAuthorizationCode, OAuthClient, OAuthGrant, OAuthRefreshToken
from app.models.user import User
from app.services.errors import OperationError
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


def create_mcp_access_token(user: User, client_id: str, grant_version: int) -> str:
    now = _now()
    payload = {
        "sub": user.auth_subject,
        "aud": RESOURCE_URL,
        "client_id": client_id,
        "tv": user.token_version or 0,
        "gv": grant_version,
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
    subject = payload.get("sub")
    if not subject:
        return None
    user = db.query(User).filter(User.auth_subject == subject).first()
    if user is None or payload.get("tv", 0) != (user.token_version or 0):
        return None
    client_id = payload.get("client_id")
    if not client_id or payload.get("gv") is None:
        return None
    grant = db.get(OAuthGrant, (user.id, client_id))
    if grant is None or payload["gv"] != grant.version:
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
    token_version = user.token_version or 0
    # Acquire SQLite's writer lock before reading/creating the client grant.
    # The conditional update also rejects an in-flight consent whose session
    # was revoked after authentication, without adopting the new version.
    current = (
        db.query(User)
        .filter(User.id == user.id, User.token_version == token_version)
        .update({User.token_version: User.token_version}, synchronize_session=False)
    )
    if not current:
        db.rollback()
        raise OperationError(status_code=401, detail="Session has been revoked. Sign in again.")
    grant = db.get(OAuthGrant, (user.id, request["client_id"]))
    if grant is None:
        grant = OAuthGrant(user_id=user.id, client_id=request["client_id"], version=0)
        db.add(grant)
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
            token_version=token_version,
            grant_version=grant.version,
            expires_at=_now() + AUTHORIZATION_CODE_LIFETIME,
        )
    )
    db.commit()
    return construct_redirect_uri(request["redirect_uri"], code=code, state=request["state"])


def connected_apps(db: Session, user: User) -> list[dict]:
    """Clients that still hold a usable refresh token for this account."""
    rows = (
        db.query(OAuthRefreshToken)
        .join(
            OAuthGrant,
            (OAuthGrant.user_id == OAuthRefreshToken.user_id)
            & (OAuthGrant.client_id == OAuthRefreshToken.client_id),
        )
        .filter(
            OAuthRefreshToken.user_id == user.id,
            OAuthRefreshToken.token_version == (user.token_version or 0),
            OAuthRefreshToken.grant_version == OAuthGrant.version,
        )
        .all()
    )
    live = {row.client_id for row in rows if as_utc(row.expires_at) > _now()}
    apps = []
    for client_id in live:
        info = get_client_info(db, client_id)
        apps.append(
            {"client_id": client_id, "name": (info and info.client_name) or "Connected app"}
        )
    return sorted(apps, key=lambda app: (app["name"].lower(), app["client_id"]))


def disconnect_app(db: Session, user: User, client_id: str) -> None:
    """Revoke one client's access to this account, including access tokens already issued."""
    grant = db.get(OAuthGrant, (user.id, client_id))
    if grant is None:
        raise OperationError(status_code=404, detail="That app is not connected to your account.")
    # Access tokens carry the grant version, so bumping it ends them immediately.
    grant.version += 1
    for model in (OAuthAuthorizationCode, OAuthRefreshToken):
        db.query(model).filter(model.user_id == user.id, model.client_id == client_id).delete()
    db.commit()


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
        # Disconnect this account/client pair, including existing access tokens.
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
            # Consume and read the persisted approval in one write statement.
            # SQLite serializes this with revocation until the commit below.
            row = db.execute(
                delete(OAuthAuthorizationCode)
                .where(
                    OAuthAuthorizationCode.code_hash == _hash(code.code),
                    OAuthAuthorizationCode.client_id == client.client_id,
                )
                .returning(OAuthAuthorizationCode)
            ).scalar_one_or_none()
            if row is None or as_utc(row.expires_at) <= _now():
                db.rollback()
                raise TokenError(error="invalid_grant", error_description="Code invalid or used")
            return self._issue_tokens(db, row)

    def _load_refresh(self, client_id: str, token: str) -> RefreshToken | None:
        with SessionLocal() as db:
            row = db.get(OAuthRefreshToken, _hash(token))
            if row is None or row.client_id != client_id or row.user is None:
                return None
            if row.token_version != (row.user.token_version or 0):
                return None
            grant = db.get(OAuthGrant, (row.user_id, client_id))
            if grant is None or row.grant_version != grant.version:
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
            row = db.execute(
                delete(OAuthRefreshToken)
                .where(
                    OAuthRefreshToken.token_hash == _hash(refresh.token),
                    OAuthRefreshToken.client_id == client.client_id,
                )
                .returning(OAuthRefreshToken)
            ).scalar_one_or_none()
            if row is None or as_utc(row.expires_at) <= _now():
                db.rollback()
                raise TokenError(
                    error="invalid_grant", error_description="Refresh token invalid or used"
                )
            return self._issue_tokens(db, row, scopes=scopes or row.scopes)

    def _issue_tokens(
        self,
        db: Session,
        credential: OAuthAuthorizationCode | OAuthRefreshToken,
        *,
        scopes: list[str] | None = None,
    ) -> OAuthToken:
        user = db.get(User, credential.user_id)
        grant = db.get(OAuthGrant, (credential.user_id, credential.client_id))
        if (
            user is None
            or credential.token_version != (user.token_version or 0)
            or grant is None
            or credential.grant_version != grant.version
        ):
            db.rollback()
            raise TokenError(error="invalid_grant", error_description="Authorization revoked")
        scopes = credential.scopes if scopes is None else scopes
        # Sign before commit: expire-on-commit must never reload a newer
        # account version and turn an in-flight revoked grant into fresh access.
        access = create_mcp_access_token(user, credential.client_id, credential.grant_version)
        refresh = secrets.token_urlsafe(32)
        db.add(
            OAuthRefreshToken(
                token_hash=_hash(refresh),
                client_id=credential.client_id,
                user_id=user.id,
                scopes=scopes,
                resource=credential.resource,
                token_version=credential.token_version,
                grant_version=credential.grant_version,
                expires_at=_now() + REFRESH_TOKEN_LIFETIME,
            )
        )
        db.commit()
        return OAuthToken(
            access_token=access,
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
            # The SDK validated this token earlier. Resolve the exact credential
            # again: a delayed revoke must not affect a reauthorized client or a
            # replacement account that reused the original numeric user ID.
            if isinstance(token, RefreshToken):
                row = db.execute(
                    delete(OAuthRefreshToken)
                    .where(
                        OAuthRefreshToken.token_hash == _hash(token.token),
                        OAuthRefreshToken.client_id == token.client_id,
                    )
                    .returning(OAuthRefreshToken)
                ).scalar_one_or_none()
                if row is None:
                    return
                user = db.get(User, row.user_id)
                if user is None:
                    return
                client_id = row.client_id
                token_version, grant_version = row.token_version, row.grant_version
            else:
                resolved = user_from_mcp_access_token(token.token, db)
                if resolved is None:
                    return
                user, payload = resolved
                client_id = payload["client_id"]
                token_version, grant_version = payload["tv"], payload["gv"]
            updated = (
                db.query(OAuthGrant)
                .filter(
                    OAuthGrant.user_id.in_(
                        select(User.id).where(
                            User.auth_subject == user.auth_subject,
                            User.token_version == token_version,
                        )
                    ),
                    OAuthGrant.client_id == client_id,
                    OAuthGrant.version == grant_version,
                )
                .update({OAuthGrant.version: OAuthGrant.version + 1}, synchronize_session=False)
            )
            if not updated:
                db.rollback()
                return
            for model in (OAuthAuthorizationCode, OAuthRefreshToken):
                db.query(model).filter(
                    model.user_id == user.id, model.client_id == client_id
                ).delete()
            db.commit()
