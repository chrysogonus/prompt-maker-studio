"""Account HTTP endpoints."""

from datetime import timedelta
import logging

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api import deps
from app.auth.cookies import clear_session, issue_session, session_expires_at
from app.auth.dependencies import get_current_user
from app.auth.utils import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
)
from app.database.connection import get_db
from app.limiter import limiter
from app.models.user import User
from app.schemas.accounts import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    UserResponse,
    UserUpdate,
)

logger = logging.getLogger(__name__)
from app.services.accounts import profile

router = APIRouter(prefix="/api/auth", tags=["authentication"])


@router.get("/me", response_model=UserResponse)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    """
    Get current authenticated user information.

    Args:
        current_user: Current authenticated user from JWT token

    Returns:
        Current user information
    """
    return current_user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def delete_account(
    request: Request,
    response: Response,
    body: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Permanently delete the authenticated user's account and all their data.

    Everything referencing this user is removed with it: prompts (and their
    versions, eval cases, eval runs, and run results), Playground runs, and
    billed calls. Those cascades are declared on User/Prompt in models/ and
    backed by ON DELETE CASCADE in the schema — see migration 020. Note that
    dropping billed_calls also drops that user's contribution to the monthly
    GLOBAL_MONTHLY_BUDGET_USD window, which is the accepted cost of honouring
    "permanent deletion" literally.

    Requires the current password. This is irreversible and destroys everything
    listed above, so an unattended or stolen browser session must not be enough
    on its own — the Settings UI previously needed only two clicks.

    The caller's JWT token becomes immediately inert (the subject no longer exists
    in the database) so no explicit token revocation is needed; session cookies
    are cleared so the browser is not left holding a dead session.

    Returns:
        204 No Content on success

    Raises:
        HTTPException 401: If the request is not authenticated, or the password
            does not match
    """
    deps.call_service(profile.delete_account, body=body, current_user=current_user, db=db)
    clear_session(response)


@router.patch("/me", response_model=UserResponse)
@limiter.limit("10/minute")
def update_profile(
    request: Request,
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Update the authenticated user's profile and Settings preferences.

    Providing an email is required before the password-reset flow can be used.
    The email is stored in lower-case and must be globally unique.

    Rate-limited: the 409 conflict response on email/username collision would
    otherwise let an unthrottled caller enumerate registered accounts.

    Returns:
        Updated user profile

    Raises:
        HTTPException 409: If the email address is already in use by another account
    """
    return deps.call_service(profile.update_profile, body=body, current_user=current_user, db=db)


@router.post("/change-password", status_code=status.HTTP_200_OK)
@limiter.limit("5/minute")
def change_password(
    request: Request,
    response: Response,
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Change the authenticated user's password after verifying their current one.

    Every existing session is revoked by bumping `token_version`, then the
    caller is re-issued a token on the new version. Changing a password is how
    someone evicts an attacker holding a stolen session, so leaving other
    tokens valid until expiry would defeat the point — but signing the caller
    out of the tab they are using to do it would be gratuitous.

    Returns:
        {"message": ..., "expires_at": ...} — the renewed session's expiry

    Raises:
        HTTPException 401: If current_password does not match the stored hash
    """
    deps.call_service(profile.change_password, body=body, current_user=current_user, db=db)
    issue_session(
        response,
        create_access_token(
            subject=current_user.auth_subject,
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
            token_version=current_user.token_version,
        ),
    )
    return {"message": "Password updated successfully.", "expires_at": session_expires_at()}
