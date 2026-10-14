"""Registration operations; mutations own their database commit."""

from http import HTTPStatus
import logging
import os

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.utils import (
    get_password_hash,
)
from app.metrics import observe_operation
from app.models.user import User
from app.schemas.accounts import (
    UserCreate,
)
from app.services.errors import OperationError

logger = logging.getLogger(__name__)


def _registration_mode() -> str:
    """`open` or `closed`; anything unrecognised is treated as closed."""
    mode = os.getenv("REGISTRATION_MODE", "closed").strip().lower()
    return "open" if mode == "open" else "closed"


def _assert_registration_allowed(db: Session) -> None:
    """Gate public sign-up behind an operator decision."""
    if _registration_mode() == "open":
        return
    if db.query(User).first() is None:
        return
    raise OperationError(
        status_code=HTTPStatus.FORBIDDEN,
        detail="Registration is closed on this instance. Ask the operator for an account.",
    )


@observe_operation("signup")
def register(user_data: UserCreate, db: Session):
    """Register a new user."""
    _assert_registration_allowed(db)
    normalized_username = user_data.username.strip().lower()
    normalized_email = str(user_data.email).strip().lower()
    conflict = (
        db.query(User)
        .filter((User.username == normalized_username) | (User.email == normalized_email))
        .first()
    )
    if conflict:
        raise OperationError(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="Username or email already registered",
        )
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        username=normalized_username, hashed_password=hashed_password, email=normalized_email
    )
    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
    except IntegrityError as exc:
        db.rollback()
        raise OperationError(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="Username or email already registered",
        ) from exc
    return new_user
