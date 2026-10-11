"""Profile operations; mutations own their database commit."""

from http import HTTPStatus
import logging

from sqlalchemy.orm import Session

from app.auth.utils import (
    get_password_hash,
    verify_password,
)
from app.models.user import User
from app.schemas.accounts import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    UserUpdate,
)
from app.services.errors import OperationError

logger = logging.getLogger(__name__)


def delete_account(body: DeleteAccountRequest, current_user: User, db: Session):
    """Permanently delete the authenticated user's account and all their data."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise OperationError(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail="Password is incorrect",
        )
    db.delete(current_user)
    db.commit()


def _apply_preference_updates(body: UserUpdate, current_user: User) -> None:
    """Apply the simple, non-conflict-checked preference fields of a profile update."""
    if body.default_library_view is not None:
        current_user.default_library_view = body.default_library_view
    if body.default_eval_method is not None:
        current_user.default_eval_method = body.default_eval_method
    if body.auto_run_eval_on_update is not None:
        current_user.auto_run_eval_on_update = body.auto_run_eval_on_update


def update_profile(body: UserUpdate, current_user: User, db: Session):
    """Update the authenticated user's profile and Settings preferences."""
    if body.email is not None:
        normalized = str(body.email).strip().lower()
        conflict = (
            db.query(User).filter(User.email == normalized, User.id != current_user.id).first()
        )
        if conflict:
            raise OperationError(
                status_code=HTTPStatus.CONFLICT,
                detail="Email address already in use",
            )
        current_user.email = normalized
    if body.new_username is not None:
        normalized_username = body.new_username.strip().lower()
        conflict = (
            db.query(User)
            .filter(User.username == normalized_username, User.id != current_user.id)
            .first()
        )
        if conflict:
            raise OperationError(
                status_code=HTTPStatus.CONFLICT,
                detail="Username already in use",
            )
        current_user.username = normalized_username
    _apply_preference_updates(body, current_user)
    db.commit()
    db.refresh(current_user)
    return current_user


def change_password(body: ChangePasswordRequest, current_user: User, db: Session):
    """Change the authenticated user's password after verifying their current one."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise OperationError(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail="Current password is incorrect",
        )
    current_user.hashed_password = get_password_hash(body.new_password)
    current_user.token_version = (current_user.token_version or 0) + 1
    db.commit()
    db.refresh(current_user)
