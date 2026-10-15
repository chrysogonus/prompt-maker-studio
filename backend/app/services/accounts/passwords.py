"""Password recovery tokens, email delivery and session revocation."""

from datetime import UTC, datetime, timedelta
from http import HTTPStatus
import logging
import os
import secrets

from sqlalchemy.orm import Session

from app.auth.utils import (
    get_password_hash,
    hash_password_reset_token,
)
from app.metrics import observe_operation, operation
from app.models.user import User
from app.schemas.accounts import (
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from app.services.email_service import send_password_reset_email
from app.services.errors import OperationError

logger = logging.getLogger(__name__)

_RESET_TOKEN_EXPIRY_HOURS = 1


def forgot_password(body: ForgotPasswordRequest, db: Session):
    """Request a password-reset email."""
    normalized_email = str(body.email).strip().lower()
    user = db.query(User).filter(User.email == normalized_email).first()

    if user is not None:
        token = secrets.token_urlsafe(32)
        user.reset_token = hash_password_reset_token(token)
        user.reset_token_expiry = datetime.now(UTC) + timedelta(hours=_RESET_TOKEN_EXPIRY_HOURS)

        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        reset_link = f"{frontend_url}/reset-password?token={token}"

        with operation("password_reset_email") as state:
            try:
                send_password_reset_email(to_email=normalized_email, reset_link=reset_link)
            except Exception:
                state.outcome = "error"
                state.error_type = "provider"
                db.rollback()
                # Keep delivery failures actionable without exposing account existence.
                logger.error("password_reset_email_failed")
            else:
                db.commit()

    return {"message": "If that email is registered, a reset link has been sent."}


@observe_operation("password_reset")
def reset_password(body: ResetPasswordRequest, db: Session):
    """Complete a password reset using the token from the reset email."""
    token_hash = hash_password_reset_token(body.token)
    user = db.query(User).filter(User.reset_token == token_hash).first()

    invalid_exc = OperationError(
        status_code=HTTPStatus.BAD_REQUEST,
        detail="Reset token is invalid or has expired.",
    )

    if user is None:
        raise invalid_exc

    expiry = user.reset_token_expiry
    if expiry is None:
        raise invalid_exc

    # Normalise to UTC-aware for comparison
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=UTC)

    if datetime.now(UTC) > expiry:
        # Token expired — clean up so it can't be retried
        user.reset_token = None
        user.reset_token_expiry = None
        db.commit()
        raise invalid_exc

    user.hashed_password = get_password_hash(body.new_password)
    user.reset_token = None
    user.reset_token_expiry = None
    # Recovering an account has to evict whoever prompted the recovery. Without
    # this, a stolen session stays usable for the rest of its lifetime and the
    # reset accomplishes nothing against an attacker who already has one.
    user.token_version = User.token_version + 1
    db.commit()

    return {"message": "Password updated successfully."}
