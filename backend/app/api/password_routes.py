"""Rate-limited password recovery HTTP endpoints."""

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.api.deps import call_service
from app.database.connection import get_db
from app.limiter import limiter
from app.schemas.accounts import ForgotPasswordRequest, ResetPasswordRequest
from app.services.accounts import passwords

router = APIRouter(prefix="/api/auth", tags=["authentication"])


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
@limiter.limit("5/minute")
def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Request a password-reset email.

    Always returns 200 regardless of whether the email is found so that the
    response does not reveal whether an account with that address exists.

    The reset token is valid for 1 hour.

    Returns:
        {"message": "If that email is registered, a reset link has been sent."}
    """
    return call_service(passwords.forgot_password, body, db)


@router.post("/reset-password", status_code=status.HTTP_200_OK)
@limiter.limit("10/minute")
def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Complete a password reset using the token from the reset email.

    The token is single-use and expires after 1 hour.  On success the token
    fields are cleared so it cannot be reused.

    Returns:
        {"message": "Password updated successfully."}

    Raises:
        HTTPException 400: If the token is invalid or expired
    """
    return call_service(passwords.reset_password, body, db)
