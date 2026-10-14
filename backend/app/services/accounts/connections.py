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
)
from app.services.llm_model_catalog import invalidate_model_cache
from app.services.llm_providers import PROVIDERS, InvalidConnectionError, resolve_connection
from app.services.secret_store import (
    SecretDecryptionError,
    decrypt_secret,
    encrypt_secret,
    mask_secret,
)
from app.services.spend_ledger import record_billed_call

logger = logging.getLogger(__name__)


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
        has_api_key=has_key,
        api_key_hint=hint,
        providers=_provider_options(),
        server_default=(
            LLMServerDefault(provider_label=default.provider.label, model=default.model)
            if default
            else None
        ),
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
    current_user.llm_api_key_encrypted = None
    db.commit()
    db.refresh(current_user)
    invalidate_model_cache(current_user.id)
    return _connection_response(current_user)


@observe_operation("connection_test")
def test_llm_connection(current_user: User, db: Session):
    """Send a one-token probe to the configured provider so a wrong endpoint, key,
    or model name is reported here rather than as a mystery failure inside a
    feature. Rate-limited: it is a real (if tiny) billed call."""
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
        connection = client_for(current_user)
        _, usage = text_completion(
            connection, [{"role": "user", "content": "Reply with the word: ok"}]
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
