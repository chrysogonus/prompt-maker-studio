"""Session HTTP endpoints."""

from datetime import UTC, datetime, timedelta
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.api import deps
from app.auth.cookies import (
    CSRF_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    clear_session,
    issue_session,
    session_expires_at,
)
from app.auth.dependencies import get_current_user, security
from app.auth.utils import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    MAX_SESSION_AGE,
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)
from app.database.connection import get_db
from app.limiter import limiter
from app.metrics import observe_operation
from app.models.user import User
from app.schemas.accounts import (
    Token,
    UserCreate,
    UserLogin,
    UserResponse,
)

logger = logging.getLogger(__name__)
from app.services.accounts import registration

router = APIRouter(prefix="/api/auth", tags=["authentication"])

_REGISTER_RATE_LIMIT = os.getenv("REGISTER_RATE_LIMIT", "5/minute")


_LOGIN_RATE_LIMIT = os.getenv("LOGIN_RATE_LIMIT", "10/minute")

# Match the cost of a failed password check even when the username is unknown.
_DUMMY_PASSWORD_HASH = get_password_hash("unused-login-password")


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(_REGISTER_RATE_LIMIT)
def register(request: Request, user_data: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user.

    Args:
        user_data: User registration data (username and password)
        db: Database session

    Returns:
        Created user information

    Raises:
        HTTPException 403: If registration is closed and an account already exists
        HTTPException 400: If username already exists
    """
    return deps.call_service(registration.register, user_data=user_data, db=db)


@router.post("/login", response_model=Token)
@limiter.limit(_LOGIN_RATE_LIMIT)
@observe_operation("login")
def login(
    request: Request,
    response: Response,
    user_credentials: UserLogin,
    db: Session = Depends(get_db),
):
    """
    Authenticate user and start a session.

    The token is delivered as an httpOnly cookie so page scripts cannot read
    it. The body carries only `expires_at`, which the UI needs for its session
    countdown and which reveals nothing on its own.

    Args:
        user_credentials: User login credentials (username or email, and password)
        db: Database session

    Returns:
        Session expiry metadata

    Raises:
        HTTPException: If credentials are invalid
    """
    # Usernames cannot contain "@", so the identifier is unambiguous.
    identifier = user_credentials.username.strip().lower()
    column = User.email if "@" in identifier else User.username
    user = db.query(User).filter(column == identifier).first()

    password_matches = verify_password(
        user_credentials.password, user.hashed_password if user else _DUMMY_PASSWORD_HASH
    )
    if user is None or not password_matches:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username, email, or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        subject=user.auth_subject,
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        token_version=user.token_version or 0,
    )
    issue_session(response, access_token)

    return {"token_type": "bearer", "expires_at": session_expires_at()}


@router.post("/refresh", response_model=Token)
@limiter.limit("10/minute")
def refresh_access_token(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
):
    """
    Renew a still-valid session while the user is active.

    Renewal never extends a session past `MAX_SESSION_AGE` after the user last
    authenticated; once that is reached the user has to sign in again.
    """
    # Same precedence as get_current_user, which has already validated it.
    token = request.cookies.get(SESSION_COOKIE_NAME) or credentials.credentials
    payload = decode_access_token(token)
    # Tokens issued before auth_time existed fall back to their issue time.
    auth_time = payload.get("auth_time", payload["iat"])

    now = datetime.now(UTC)
    session_end = datetime.fromtimestamp(auth_time, UTC) + MAX_SESSION_AGE
    lifetime = min(timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES), session_end - now)
    if lifetime <= timedelta(0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session reached its maximum length. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        subject=current_user.auth_subject,
        expires_delta=lifetime,
        token_version=current_user.token_version or 0,
        auth_time=auth_time,
    )
    # With cookie auth, get_current_user has checked this CSRF token against the
    # header. Keeping it means writes sent alongside the refresh still match.
    checked_csrf = (
        request.cookies.get(CSRF_COOKIE_NAME) if request.cookies.get(SESSION_COOKIE_NAME) else None
    )
    issue_session(response, access_token, csrf_token=checked_csrf)
    return {"token_type": "bearer", "expires_at": now + lifetime}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    """
    End the session by clearing its cookies.

    Deliberately unauthenticated: signing out must succeed even when the token
    has already expired, and it grants nothing.

    Only affects this browser. Use /logout-all to invalidate every session.
    """
    clear_session(response)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def logout_everywhere(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Invalidate every session for the authenticated user, including this one.

    Bumping `token_version` makes every token minted before now fail
    authentication, so a session copied to another machine stops working
    immediately rather than at its own expiry.
    """
    current_user.token_version = User.token_version + 1
    db.commit()
    clear_session(response)
