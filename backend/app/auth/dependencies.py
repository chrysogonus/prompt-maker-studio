"""
Authentication dependencies for route protection.
"""

import logging
import secrets

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.cookies import (
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    SAFE_METHODS,
    SESSION_COOKIE_NAME,
)
from app.auth.utils import decode_access_token
from app.database.connection import get_db
from app.models.user import User

logger = logging.getLogger(__name__)

# auto_error=False: a missing Authorization header is no longer a failure on its
# own, because the session cookie is now the primary credential.
security = HTTPBearer(auto_error=False)


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _enforce_csrf(request: Request) -> None:
    """
    Require a matching CSRF token on cookie-authenticated state changes.

    Only applies to cookie auth: a `Authorization: Bearer` request cannot be
    forged by another origin, because a browser never attaches that header on
    its own. Safe methods are exempt — they change nothing.
    """
    if request.method in SAFE_METHODS:
        return

    header_token = request.headers.get(CSRF_HEADER_NAME)
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    # `compare_digest` rather than `==` so a mismatch cannot be narrowed down by
    # timing. It needs two strings, hence the emptiness check first.
    if (
        not header_token
        or not cookie_token
        or not secrets.compare_digest(header_token, cookie_token)
    ):
        logger.debug("Rejected a cookie-authenticated %s with no valid CSRF token", request.method)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing or invalid CSRF token",
        )


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """
    Dependency to get the current authenticated user.

    Prefers the httpOnly session cookie, falling back to a bearer token so
    non-browser clients (scripts, CI) keep working. Cookie-authenticated
    writes must also carry a CSRF token.

    Args:
        request: Incoming request, for its cookies and headers
        credentials: HTTP bearer token credentials, if the client sent any
        db: Database session

    Returns:
        Current authenticated user

    Raises:
        HTTPException: If the credentials are absent, invalid, or CSRF fails
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        _enforce_csrf(request)
    elif credentials is not None:
        token = credentials.credentials

    if not token:
        logger.debug("Request carried neither a session cookie nor a bearer token")
        raise _credentials_exception()

    payload = decode_access_token(token)

    if payload is None:
        logger.debug("Token could not be decoded or has expired")
        raise _credentials_exception()

    username: str | None = payload.get("sub")
    if username is None:
        logger.debug("Token payload is missing the 'sub' claim")
        raise _credentials_exception()

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        logger.debug("Token subject %r does not match any user", username)
        raise _credentials_exception()

    # A token minted before the user's last password change, reset, or explicit
    # "sign out everywhere" is no longer valid, however much of its lifetime is
    # left. Tokens issued before this claim existed have no "tv" and are treated
    # as version 0, which matches the column default.
    if payload.get("tv", 0) != (user.token_version or 0):
        logger.debug("Token for %r was issued before sessions were last revoked", username)
        raise _credentials_exception()

    return user
