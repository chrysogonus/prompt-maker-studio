"""
Authentication route handlers for user registration and login.
"""

from datetime import UTC, datetime, timedelta
import logging
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import deps
from app.auth.cookies import clear_session, issue_session, session_expires_at
from app.auth.dependencies import get_current_user
from app.auth.utils import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    get_password_hash,
    hash_password_reset_token,
    verify_password,
)
from app.database.connection import get_db
from app.limiter import limiter
from app.metrics import (
    login_successes_total,
    password_reset_email_failures_total,
    user_registrations_total,
)
from app.models.schemas import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    LLMConnectionResponse,
    LLMConnectionTestResponse,
    LLMConnectionUpdate,
    LLMProviderOption,
    ModelPriceInfo,
    ResetPasswordRequest,
    Token,
    UserCreate,
    UserLogin,
    UserResponse,
    UserUpdate,
)
from app.models.user import User
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.email_service import redact_email, send_password_reset_email
from app.services.llm_client import (
    client_for,
    describe_llm_error,
    is_configured,
    text_completion,
)
from app.services.llm_model_catalog import invalidate_model_cache, model_catalog_for
from app.services.llm_providers import PROVIDERS, InvalidConnectionError, resolve_connection
from app.services.secret_store import (
    SecretDecryptionError,
    decrypt_secret,
    encrypt_secret,
    mask_secret,
)
from app.services.spend_ledger import record_billed_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["authentication"])

# Overridable only so the isolated E2E Compose stack (which runs many short-lived
# throwaway registrations across a Playwright suite in one worker) doesn't collide
# with the production-safe default. Unset everywhere except docker-compose.e2e.yml.
_REGISTER_RATE_LIMIT = os.getenv("REGISTER_RATE_LIMIT", "5/minute")
# Same rationale: each of those registrations is followed by a login, and the
# suite also signs back in explicitly, so the login limit binds before the
# registration one does.
_LOGIN_RATE_LIMIT = os.getenv("LOGIN_RATE_LIMIT", "10/minute")


def _registration_mode() -> str:
    """`open` or `closed`; anything unrecognised is treated as closed."""
    mode = os.getenv("REGISTRATION_MODE", "closed").strip().lower()
    return "open" if mode == "open" else "closed"


def _assert_registration_allowed(db: Session) -> None:
    """Gate public sign-up behind an operator decision.

    A self-hosted deployment on the public internet should not hand an account
    to every visitor by default: an account is what unlocks server-side
    requests to a user-supplied provider URL, so open registration turns that
    feature into an SSRF primitive for anyone at all (see llm_providers.
    assert_public_host). Closed is therefore the default.

    The first account is always allowed through, so a fresh install is still
    usable out of the box — whoever reaches it first becomes the operator, and
    registration locks behind them.
    """
    if _registration_mode() == "open":
        return
    if db.query(User).first() is None:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Registration is closed on this instance. Ask the operator for an account.",
    )


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
    _assert_registration_allowed(db)

    normalized_username = user_data.username.strip().lower()
    normalized_email = str(user_data.email).strip().lower()

    existing_user = db.query(User).filter(User.username == normalized_username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    existing_email = db.query(User).filter(User.email == normalized_email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address already registered",
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already registered",
        ) from exc

    user_registrations_total.inc()
    return new_user


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
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password is incorrect",
        )

    db.delete(current_user)
    db.commit()
    clear_session(response)


def _apply_preference_updates(body: UserUpdate, current_user: User) -> None:
    """Apply the simple, non-conflict-checked preference fields of a profile update."""
    if body.notify_run_failure is not None:
        current_user.notify_run_failure = body.notify_run_failure
    if body.notify_weekly_summary is not None:
        current_user.notify_weekly_summary = body.notify_weekly_summary
    if body.default_library_view is not None:
        current_user.default_library_view = body.default_library_view
    if body.default_eval_method is not None:
        current_user.default_eval_method = body.default_eval_method
    if body.auto_run_eval_on_update is not None:
        current_user.auto_run_eval_on_update = body.auto_run_eval_on_update
    if body.notify_eval_complete is not None:
        current_user.notify_eval_complete = body.notify_eval_complete
    if body.notify_eval_regression is not None:
        current_user.notify_eval_regression = body.notify_eval_regression


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
    if body.email is not None:
        normalized = str(body.email).strip().lower()
        conflict = (
            db.query(User).filter(User.email == normalized, User.id != current_user.id).first()
        )
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
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
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already in use",
            )
        current_user.username = normalized_username

    _apply_preference_updates(body, current_user)

    db.commit()
    db.refresh(current_user)
    return current_user


def _provider_options() -> list[LLMProviderOption]:
    return [
        LLMProviderOption(
            handle=provider.handle,
            label=provider.label,
            default_base_url=provider.default_base_url,
            requires_api_key=provider.requires_api_key,
            suggested_models=list(provider.models),
            docs_url=provider.docs_url,
        )
        for provider in PROVIDERS.values()
    ]


def _connection_response(user: User) -> LLMConnectionResponse:
    """Build the connection view for `user`.

    The stored API key is never returned — only a masked hint, and only when
    it is still decryptable. An undecryptable key is reported as absent so the
    UI prompts for a fresh one instead of implying a working connection.
    """
    provider = PROVIDERS.get(user.llm_provider or "")
    hint: str | None = None
    has_key = False
    if user.llm_api_key_encrypted:
        try:
            hint = mask_secret(decrypt_secret(user.llm_api_key_encrypted))
            has_key = True
        except SecretDecryptionError:
            logger.warning("Stored LLM key for user %s is undecryptable", user.id)

    # `is_configured` is the canonical predicate every AI route keys off; the
    # extra `has_key` term makes an undecryptable stored key read as "not
    # connected" here, so the form prompts for a fresh one.
    configured = is_configured(user) and (
        has_key or bool(provider and not provider.requires_api_key)
    )
    return LLMConnectionResponse(
        configured=configured,
        provider=provider.handle if provider else None,
        provider_label=provider.label if provider else None,
        base_url=user.llm_base_url or (provider.default_base_url if provider else None),
        model=user.llm_model,
        has_api_key=has_key,
        api_key_hint=hint,
        providers=_provider_options(),
    )


@router.get("/me/llm-connection", response_model=LLMConnectionResponse)
def get_llm_connection(current_user: User = Depends(get_current_user)):
    """
    The authenticated user's bring-your-own LLM provider connection, plus the
    catalogue of selectable providers for the Settings form.

    Returns:
        The connection's provider/base URL/model and whether a key is stored —
        never the key itself.
    """
    return _connection_response(current_user)


@router.get("/me/llm-connection/models", response_model=list[ModelPriceInfo])
def get_llm_connection_models(current_user: User = Depends(get_current_user)):
    """List models exposed by the caller's provider, enriched with pricing."""
    connection = deps.get_llm_connection(current_user)
    return model_catalog_for(current_user, connection)


@router.put("/me/llm-connection", response_model=LLMConnectionResponse)
@limiter.limit("10/minute")
def update_llm_connection(
    request: Request,
    body: LLMConnectionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create or replace the authenticated user's provider connection.

    `api_key` omitted keeps the stored key; an empty string clears it. Changing
    provider always requires a fresh key, since a credential issued by one
    vendor must never be presented to another.

    Raises:
        HTTPException 422: If the provider, base URL, model, or key is invalid
    """
    changing_provider = current_user.llm_provider != body.provider
    clearing_key = body.api_key is not None and not body.api_key.strip()
    has_stored_key = bool(current_user.llm_api_key_encrypted) and not (
        changing_provider or clearing_key
    )

    try:
        resolved = resolve_connection(
            provider_handle=body.provider,
            base_url=body.base_url,
            model=body.model,
            api_key=body.api_key,
            has_stored_key=has_stored_key,
        )
    except InvalidConnectionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    current_user.llm_provider = resolved.provider.handle
    current_user.llm_base_url = resolved.base_url
    current_user.llm_model = resolved.model
    if resolved.api_key:
        current_user.llm_api_key_encrypted = encrypt_secret(resolved.api_key)
    elif changing_provider or clearing_key:
        # Overwrite rather than leave a stale ciphertext that a later provider
        # switch back could silently resurrect.
        current_user.llm_api_key_encrypted = None

    db.commit()
    db.refresh(current_user)
    invalidate_model_cache(current_user.id)
    return _connection_response(current_user)


@router.delete("/me/llm-connection", response_model=LLMConnectionResponse)
def delete_llm_connection(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Disconnect the authenticated user's provider and erase the stored key.

    Returns:
        The now-empty connection state
    """
    current_user.llm_provider = None
    current_user.llm_base_url = None
    current_user.llm_model = None
    current_user.llm_api_key_encrypted = None
    db.commit()
    db.refresh(current_user)
    invalidate_model_cache(current_user.id)
    return _connection_response(current_user)


@router.post("/me/llm-connection/test", response_model=LLMConnectionTestResponse)
@limiter.limit("5/minute")
def test_llm_connection(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Send a one-token probe to the configured provider so a wrong endpoint, key,
    or model name is reported here rather than as a mystery failure inside a
    feature. Rate-limited: it is a real (if tiny) billed call.

    Goes through the budget check and the spend ledger like every other billed
    path. It used to skip both, which made it the one endpoint that kept
    spending after a ceiling was exhausted, and left its usage invisible to the
    Dashboard.

    Returns:
        {"ok": ..., "message": ...} — always 200; the failure detail is in the
        body so the form can render it inline.
    """
    connection = None
    try:
        BudgetService.check(db, current_user.id)
    except BudgetExceededError as exc:
        return LLMConnectionTestResponse(ok=False, message=str(exc))

    try:
        connection = client_for(current_user)
        _, usage = text_completion(
            connection, [{"role": "user", "content": "Reply with the word: ok"}]
        )
    # Every failure mode here is reportable copy, including a malformed
    # response from an endpoint that isn't actually OpenAI-compatible.
    except Exception as exc:
        _, detail = describe_llm_error(exc, connection)
        logger.info("LLM connection test failed for user %s: %s", current_user.id, exc)
        return LLMConnectionTestResponse(ok=False, message=detail)

    record_billed_call(db, current_user.id, "connection_test", usage)
    db.commit()

    return LLMConnectionTestResponse(
        ok=True,
        message=f"Connected to {connection.provider_label} using '{connection.model}'.",
    )


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
        {"message": "Password updated successfully."}

    Raises:
        HTTPException 401: If current_password does not match the stored hash
    """
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )

    current_user.hashed_password = get_password_hash(body.new_password)
    current_user.token_version = (current_user.token_version or 0) + 1
    db.commit()
    db.refresh(current_user)

    issue_session(
        response,
        create_access_token(
            subject=current_user.username,
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
            token_version=current_user.token_version,
        ),
    )

    return {"message": "Password updated successfully."}


_RESET_TOKEN_EXPIRY_HOURS = 1


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
    normalized_email = str(body.email).strip().lower()
    user = db.query(User).filter(User.email == normalized_email).first()

    if user is not None:
        token = secrets.token_urlsafe(32)
        user.reset_token = hash_password_reset_token(token)
        user.reset_token_expiry = datetime.now(UTC) + timedelta(hours=_RESET_TOKEN_EXPIRY_HOURS)

        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        reset_link = f"{frontend_url}/reset-password?token={token}"

        try:
            send_password_reset_email(to_email=normalized_email, reset_link=reset_link)
        except Exception:
            db.rollback()
            password_reset_email_failures_total.inc()
            # Log as an operator-actionable event, but keep the public response generic
            # so the endpoint does not reveal whether the account exists.
            logger.exception("password_reset_email_failed email=%s", redact_email(normalized_email))
        else:
            db.commit()

    return {"message": "If that email is registered, a reset link has been sent."}


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
    token_hash = hash_password_reset_token(body.token)
    user = db.query(User).filter(User.reset_token == token_hash).first()

    invalid_exc = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
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
    user.token_version = (user.token_version or 0) + 1
    db.commit()

    return {"message": "Password updated successfully."}
