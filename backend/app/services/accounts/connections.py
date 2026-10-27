"""Connections operations; mutations own their database commit."""

import logging

from sqlalchemy.orm import Session

from app.metrics import classify_error, observe_operation, operation_context
from app.models.user import User
from app.schemas.connections import (
    LLMConnectionResponse,
    LLMConnectionTestResponse,
    LLMConnectionUpdate,
    LLMProviderOption,
    LLMServerDefault,
)
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.errors import OperationError
from app.services.llm_client import (
    client_for,
    describe_llm_error,
    has_own_connection,
    server_default,
    text_completion,
    unsaved_connection,
)
from app.services.llm_model_catalog import invalidate_model_cache, model_prices_for
from app.services.llm_providers import (
    PROVIDERS,
    InvalidConnectionError,
    private_llm_urls_allowed,
    resolve_connection,
)
from app.services.secret_store import (
    SecretDecryptionError,
    decrypt_secret,
    encrypt_secret,
    mask_secret,
)
from app.services.spend_ledger import bill_failed_attempts, record_billed_call

logger = logging.getLogger(__name__)


def _provider_options() -> list[LLMProviderOption]:
    return [
        LLMProviderOption(
            handle=provider.handle,
            label=provider.label,
            default_base_url=provider.default_base_url,
            requires_api_key=provider.requires_api_key,
            suggested_models=list(provider.models),
            models=model_prices_for(provider, provider.models),
            docs_url=provider.docs_url,
        )
        for provider in PROVIDERS.values()
    ]


def _connection_response(user: User) -> LLMConnectionResponse:
    """Build the connection view for `user`."""
    provider = PROVIDERS.get(user.llm_provider or "")
    hint: str | None = None
    has_key = False
    if user.llm_api_key_encrypted:
        try:
            hint = mask_secret(decrypt_secret(user.llm_api_key_encrypted))
            has_key = True
        except SecretDecryptionError:
            logger.warning("Stored LLM key for user %s is undecryptable", user.id)
    configured = has_own_connection(user) and (
        has_key or bool(provider and not provider.requires_api_key)
    )
    default = server_default()
    return LLMConnectionResponse(
        configured=configured,
        provider=provider.handle if provider else None,
        provider_label=provider.label if provider else None,
        base_url=user.llm_base_url or (provider.default_base_url if provider else None),
        model=user.llm_model,
        workspace_id=user.llm_workspace_id if provider and provider.handle == "anthropic" else None,
        has_api_key=has_key,
        api_key_hint=hint,
        providers=_provider_options(),
        server_default=(
            LLMServerDefault(provider_label=default.provider.label, model=default.model)
            if default
            else None
        ),
        private_urls_allowed=private_llm_urls_allowed(),
    )


def get_llm_connection(current_user: User):
    """The authenticated user's bring-your-own LLM provider connection, plus the
    catalogue of selectable providers for the Settings form."""
    return _connection_response(current_user)


def update_llm_connection(body: LLMConnectionUpdate, current_user: User, db: Session):
    """Create or replace the authenticated user's provider connection."""
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
        raise OperationError(status_code=422, detail=str(exc)) from exc
    if resolved.provider.handle != "anthropic":
        current_user.llm_workspace_id = None
    elif "workspace_id" in body.model_fields_set:
        current_user.llm_workspace_id = body.workspace_id
    elif changing_provider:
        current_user.llm_workspace_id = None
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


def delete_llm_connection(current_user: User, db: Session):
    """Disconnect the authenticated user's provider and erase the stored key."""
    current_user.llm_provider = None
    current_user.llm_base_url = None
    current_user.llm_model = None
    current_user.llm_workspace_id = None
    current_user.llm_api_key_encrypted = None
    db.commit()
    db.refresh(current_user)
    invalidate_model_cache(current_user.id)
    return _connection_response(current_user)


def _connection_to_test(body: LLMConnectionUpdate, user: User):
    """Validate unsaved form values like a save would, without storing anything.
    As with a save, an omitted key reuses the stored one, only for the same provider;
    an empty string means no key."""
    clearing_key = body.api_key is not None and not body.api_key.strip()
    same_provider = user.llm_provider == body.provider
    use_stored = bool(user.llm_api_key_encrypted) and same_provider and not clearing_key
    resolved = resolve_connection(
        provider_handle=body.provider,
        base_url=body.base_url,
        model=body.model,
        api_key=body.api_key,
        has_stored_key=use_stored,
    )
    api_key = resolved.api_key or (
        decrypt_secret(user.llm_api_key_encrypted) if use_stored else None
    )
    workspace_id = None
    if resolved.provider.handle == "anthropic":
        workspace_id = (
            body.workspace_id
            if "workspace_id" in body.model_fields_set
            else (user.llm_workspace_id if same_provider else None)
        )
    return unsaved_connection(
        resolved.provider, resolved.model, resolved.base_url, api_key, workspace_id
    )


@observe_operation("connection_test")
def test_llm_connection(current_user: User, db: Session, body: LLMConnectionUpdate | None):
    """Send a one-token probe to the configured provider — or to the unsaved values in
    `body` — so a wrong endpoint, key, or model name is reported here rather than as a
    mystery failure inside a feature. Rate-limited: it is a real (if tiny) billed call."""
    connection = None
    try:
        BudgetService.check(db, current_user.id)
    except BudgetExceededError as exc:
        state = operation_context.get()
        if state is not None:
            state.outcome = "rejected"
            state.error_type = "budget"
        return LLMConnectionTestResponse(ok=False, message=str(exc))
    try:
        with bill_failed_attempts(db, current_user.id, "connection_test"):
            # Built inside the handler: a URL that validates can still fail to construct
            # a client (e.g. a non-numeric port), and that is reportable copy too.
            connection = (
                _connection_to_test(body, current_user) if body else client_for(current_user)
            )
            _, usage = text_completion(
                connection, [{"role": "user", "content": "Reply with the word: ok"}]
            )
    except InvalidConnectionError as exc:
        return LLMConnectionTestResponse(ok=False, message=str(exc))
    except SecretDecryptionError:
        return LLMConnectionTestResponse(
            ok=False, message="Your stored API key could not be read. Re-enter it to test."
        )
    # Every failure mode here is reportable copy, including a malformed
    # response from an endpoint that isn't actually OpenAI-compatible.
    except Exception as exc:
        state = operation_context.get()
        if state is not None:
            state.outcome, state.error_type = classify_error(exc)
        _, detail = describe_llm_error(exc, connection)
        logger.info("llm_connection_test_failed")
        return LLMConnectionTestResponse(ok=False, message=detail)
    record_billed_call(db, current_user.id, "connection_test", usage)
    db.commit()
    return LLMConnectionTestResponse(
        ok=True,
        message=f"Connected to {connection.provider_label} using '{connection.model}'.",
    )
