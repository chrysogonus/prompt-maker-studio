"""Session HTTP endpoints."""

from datetime import timedelta
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api import deps
from app.auth.cookies import clear_session, issue_session, session_expires_at
from app.auth.dependencies import get_current_user
from app.auth.utils import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    verify_password,
)
from app.database.connection import get_db
from app.limiter import limiter
from app.metrics import (
    login_successes_total,
)
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
        user_credentials: User login credentials (username and password)
        db: Database session

    Returns:
        Session expiry metadata

    Raises:
        HTTPException: If credentials are invalid
    """
    normalized_username = user_credentials.username.strip().lower()
    user = db.query(User).filter(User.username == normalized_username).first()

    if not user or not verify_password(user_credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    login_successes_total.inc()
    access_token = create_access_token(
        subject=user.username,
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
):
    """Renew a still-valid session before a long-running operation."""
    access_token = create_access_token(
        subject=current_user.username,
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        token_version=current_user.token_version or 0,
    )
    issue_session(response, access_token)
    return {"token_type": "bearer", "expires_at": session_expires_at()}


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
    current_user.token_version = (current_user.token_version or 0) + 1
    db.commit()
    clear_session(response)
