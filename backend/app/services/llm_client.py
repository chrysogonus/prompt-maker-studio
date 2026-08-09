"""
The single place an LLM client is constructed.

Every AI feature (AI import, refine questions/draft, Playground runs, eval case
runs, judge grading, eval-case generation) resolves its client from the acting
user's own provider connection through `client_for()`. There is no operator
fallback credential and no other `OpenAI(...)` construction in `app/`.

`json_completion()` exists because structured output is the one thing that does
*not* port cleanly across OpenAI-compatible endpoints: Anthropic silently
ignores `response_format`, Ollama honours only the coarse `json_object` form,
and an arbitrary gateway may reject it outright. So the JSON schema always
travels in the prompt, `response_format` is layered on as an optimisation where
the provider supports it, and the response is parsed tolerantly with one
bounded retry. Token usage from *every* attempt is billed, since every attempt
was really spent.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import os

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    OpenAI,
    OpenAIError,
    PermissionDeniedError,
    RateLimitError,
)

from app.models.user import User
from app.services.llm_providers import (
    STRUCTURED_JSON_OBJECT,
    STRUCTURED_JSON_SCHEMA,
    STRUCTURED_NONE,
    Provider,
    get_provider,
)
from app.services.secret_store import SecretDecryptionError, decrypt_secret
from app.services.spend_ledger import LLMUsage

logger = logging.getLogger(__name__)

# Local servers accept any bearer token; the SDK refuses to construct a client
# without one, so send an obvious placeholder rather than a real-looking value.
_LOCAL_API_KEY_PLACEHOLDER = "not-required"

_HTTP_UNAUTHORIZED = 401
_HTTP_FORBIDDEN = 403
_HTTP_NOT_FOUND = 404
_HTTP_PAYMENT_REQUIRED = 402
_HTTP_BAD_GATEWAY = 502
_HTTP_UNPROCESSABLE = 422


class LLMConnectionError(Exception):
    """Base for connection-resolution failures; messages are user-safe."""


class NoProviderConfiguredError(LLMConnectionError):
    """The acting user has not configured a usable LLM provider connection."""


class StoredKeyUnreadableError(LLMConnectionError):
    """The stored API key exists but cannot be decrypted (key material changed)."""


class LLMResponseFormatError(Exception):
    """The provider did not return parseable JSON, even after a retry."""


@dataclass(frozen=True)
class LLMConnection:
    """A ready-to-use client bound to one user's provider, plus its metadata."""

    provider: Provider
    model: str
    client: OpenAI

    @property
    def provider_handle(self) -> str:
        return self.provider.handle

    @property
    def provider_label(self) -> str:
        return self.provider.label


def is_configured(user: User) -> bool:
    """Whether `user` has a connection every AI feature could actually use."""
    if not user.llm_provider or not user.llm_model:
        return False
    try:
        provider = get_provider(user.llm_provider)
    except ValueError:
        return False
    if provider.requires_api_key and not user.llm_api_key_encrypted:
        return False
    return bool(user.llm_base_url or provider.default_base_url)


def available_models_for(user: User) -> list[str]:
    """
    Models to offer this user in a picker: their provider's suggested models,
    with their own configured model first. Free-text models are supported, so
    this is a convenience list rather than an allowlist — except that the
    Playground validates against it to avoid advertising an unrunnable choice.
    """
    if not is_configured(user):
        return []
    provider = get_provider(user.llm_provider)
    models = [user.llm_model]
    models.extend(m for m in provider.models if m != user.llm_model)
    return models


def timeout_seconds_for(provider: Provider) -> float:
    """Per-request ceiling. Self-hosted providers get a longer one by default
    (a local 70B model routinely takes minutes on a prompt a hosted API answers
    in seconds); LLM_TIMEOUT_SECONDS overrides both for the whole deployment."""
    override = os.getenv("LLM_TIMEOUT_SECONDS", "").strip()
    if override:
        try:
            value = float(override)
        except ValueError:
            logger.warning("Ignoring non-numeric LLM_TIMEOUT_SECONDS=%r", override)
        else:
            if value > 0:
                return value
    return provider.timeout_seconds


def client_for(user: User, model: str | None = None) -> LLMConnection:
    """
    Build the LLM client for `user`'s own provider connection.

    Args:
        user: The acting user — the connection is always theirs, never a
            shared operator credential
        model: Optional override (e.g. the Playground's model picker); falls
            back to the connection's configured model

    Raises:
        NoProviderConfiguredError: If no usable connection is configured
        StoredKeyUnreadableError: If the stored key cannot be decrypted
    """
    if not user.llm_provider:
        msg = (
            "No AI provider is connected. Add your provider and API key in "
            "Settings → API access to use AI features."
        )
        raise NoProviderConfiguredError(msg)

    try:
        provider = get_provider(user.llm_provider)
    except ValueError as exc:
        msg = (
            f"Your saved AI provider ('{user.llm_provider}') is no longer supported. "
            "Pick a provider again in Settings → API access."
        )
        raise NoProviderConfiguredError(msg) from exc

    resolved_model = (model or user.llm_model or "").strip()
    if not resolved_model:
        msg = (
            f"No model is configured for your {provider.label} connection. "
            "Set one in Settings → API access."
        )
        raise NoProviderConfiguredError(msg)

    base_url = user.llm_base_url or provider.default_base_url
    if not base_url:
        msg = f"Your {provider.label} connection has no base URL. Set one in Settings → API access."
        raise NoProviderConfiguredError(msg)

    if user.llm_api_key_encrypted:
        try:
            api_key = decrypt_secret(user.llm_api_key_encrypted)
        except SecretDecryptionError as exc:
            msg = (
                "Your stored API key could not be read (the server's encryption key changed). "
                "Re-enter it in Settings → API access."
            )
            raise StoredKeyUnreadableError(msg) from exc
    elif provider.requires_api_key:
        msg = f"No API key is configured for {provider.label}. Add one in Settings → API access."
        raise NoProviderConfiguredError(msg)
    else:
        api_key = _LOCAL_API_KEY_PLACEHOLDER

    return LLMConnection(
        provider=provider,
        model=resolved_model,
        client=OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout_seconds_for(provider),
            # One retry only: the caller is inside a synchronous HTTP request
            # (or an eval worker with its own deadline), so the SDK's default
            # backoff budget would blow past the timeout the user is waiting on.
            max_retries=1,
        ),
    )


def usage_from(response, connection: LLMConnection) -> LLMUsage:
    """Token usage for one response. `usage` is absent on some compat
    endpoints, so both fields are guarded — spend accounting degrades to zero
    rather than raising."""
    usage = getattr(response, "usage", None)
    return LLMUsage(
        provider=connection.provider_handle,
        model=connection.model,
        prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
        completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
    )


def text_completion(
    connection: LLMConnection, messages: list[dict[str, str]]
) -> tuple[str, LLMUsage]:
    """Plain chat completion — the Playground's unstructured path."""
    response = connection.client.chat.completions.create(
        model=connection.model,
        messages=messages,
    )
    return _content_of(response), usage_from(response, connection)


def _content_of(response) -> str:
    """The assistant text of a completion, tolerating an empty/absent choice
    list (some compat endpoints return one on a filtered response)."""
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    return choices[0].message.content or ""


_JSON_FENCE_MARKERS = ("```json", "```JSON", "```")


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    for marker in _JSON_FENCE_MARKERS:
        if stripped.startswith(marker):
            stripped = stripped[len(marker) :]
            break
    if stripped.endswith("```"):
        stripped = stripped[:-3]
    return stripped.strip()


def _extract_json_object(text: str) -> dict:
    """
    Parse the first complete JSON object in `text`.

    Providers without strict schema support routinely wrap the object in a
    code fence or a sentence of preamble, so a bare `json.loads` on the whole
    body is not enough.

    Raises:
        LLMResponseFormatError: If no JSON object can be recovered
    """
    candidate = _strip_code_fence(text)
    try:
        parsed = json.loads(candidate)
    except ValueError:
        parsed = None

    if parsed is None:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(candidate[start : end + 1])
            except ValueError:
                parsed = None

    if not isinstance(parsed, dict):
        msg = "The provider did not return a JSON object."
        raise LLMResponseFormatError(msg)
    return parsed


def _schema_instruction(schema: dict) -> str:
    """The prompt-side contract, used with every provider — including those
    that also accept `response_format`, since it costs little and makes a
    silently-ignored `response_format` (Anthropic) still produce valid JSON."""
    inner = schema.get("json_schema", {}).get("schema", schema)
    return (
        "Respond with a single JSON object and nothing else — no prose, no "
        "explanation, no markdown code fence. The object must conform to this "
        f"JSON Schema:\n{json.dumps(inner)}"
    )


def _response_format_for(provider: Provider, schema: dict, *, degraded: bool) -> dict | None:
    """The `response_format` to send, or None to omit it. `degraded` steps one
    rung down the ladder after a rejected or unusable first attempt."""
    capability = provider.structured_output
    if degraded:
        capability = (
            STRUCTURED_JSON_OBJECT if capability == STRUCTURED_JSON_SCHEMA else STRUCTURED_NONE
        )
    if capability == STRUCTURED_JSON_SCHEMA:
        return schema
    if capability == STRUCTURED_JSON_OBJECT:
        return {"type": "json_object"}
    return None


def json_completion(
    connection: LLMConnection,
    *,
    system_prompt: str,
    user_content: str,
    schema: dict,
) -> tuple[dict, LLMUsage]:
    """
    Run a completion that must come back as a JSON object.

    Args:
        connection: The acting user's resolved provider connection
        system_prompt: Feature-specific system instructions; the JSON Schema
            contract is appended automatically
        user_content: The user-turn content
        schema: An OpenAI-style `{"type": "json_schema", "json_schema": {...}}`
            block. Providers that can enforce it get it as `response_format`;
            the inner schema is put in the prompt for everyone.

    Returns:
        (parsed_object, usage) — usage sums every attempt made

    Raises:
        LLMResponseFormatError: If no attempt produced a JSON object
        openai.OpenAIError: If the upstream call itself fails
    """
    messages = [
        {"role": "system", "content": f"{system_prompt}\n\n{_schema_instruction(schema)}"},
        {"role": "user", "content": user_content},
    ]
    total = LLMUsage(
        provider=connection.provider_handle,
        model=connection.model,
        prompt_tokens=0,
        completion_tokens=0,
    )
    last_error: Exception | None = None

    for degraded in (False, True):
        response_format = _response_format_for(connection.provider, schema, degraded=degraded)
        kwargs = {"response_format": response_format} if response_format else {}
        try:
            response = connection.client.chat.completions.create(
                model=connection.model,
                messages=messages,
                **kwargs,
            )
        except BadRequestError as exc:
            # A gateway that rejects `response_format` outright: drop it and
            # rely on the prompt-side contract. Any other 400 is the caller's
            # problem (bad model name, oversized prompt) and must propagate.
            if response_format is None or degraded:
                raise
            logger.info(
                "Provider %s rejected response_format; retrying prompt-only: %s",
                connection.provider_handle,
                exc,
            )
            last_error = exc
            continue

        attempt_usage = usage_from(response, connection)
        total = LLMUsage(
            provider=total.provider,
            model=total.model,
            prompt_tokens=total.prompt_tokens + attempt_usage.prompt_tokens,
            completion_tokens=total.completion_tokens + attempt_usage.completion_tokens,
        )

        try:
            return _extract_json_object(_content_of(response)), total
        except LLMResponseFormatError as exc:
            last_error = exc
            logger.info(
                "Provider %s returned unparseable JSON (degraded=%s); retrying",
                connection.provider_handle,
                degraded,
            )

    msg = (
        f"{connection.provider_label} did not return valid JSON for model "
        f"'{connection.model}'. Try a more capable model in Settings → API access."
    )
    raise LLMResponseFormatError(msg) from last_error


# (exception type) -> (status, message template taking `who` = provider label).
# Ordered most specific first; the APITimeoutError/APIConnectionError pair must
# precede APIStatusError's ancestor checks, and AuthenticationError must
# precede APIStatusError since it *is* one.
_ERROR_RULES: tuple[tuple[type[Exception], int, str], ...] = (
    (
        AuthenticationError,
        _HTTP_UNPROCESSABLE,
        "{who} rejected your API key. Check or replace it in Settings → API access.",
    ),
    (
        PermissionDeniedError,
        _HTTP_UNPROCESSABLE,
        "{who} refused this request for your API key — it may lack access to this model.",
    ),
    (
        RateLimitError,
        _HTTP_PAYMENT_REQUIRED,
        (
            "{who} reported a rate limit or exhausted quota. "
            "Check your account's limits and billing."
        ),
    ),
    (
        NotFoundError,
        _HTTP_UNPROCESSABLE,
        (
            "{who} has no model matching your configured model name. "
            "Check it in Settings → API access."
        ),
    ),
    (APITimeoutError, _HTTP_BAD_GATEWAY, "{who} did not respond in time. Please try again."),
    (
        APIConnectionError,
        _HTTP_BAD_GATEWAY,
        (
            "Could not reach {who} at the configured base URL. "
            "Check the endpoint in Settings → API access."
        ),
    ),
)

_STATUS_RULES: dict[int, tuple[int, str]] = {
    _HTTP_UNAUTHORIZED: (
        _HTTP_UNPROCESSABLE,
        "{who} rejected your API key. Check or replace it in Settings → API access.",
    ),
    _HTTP_FORBIDDEN: (
        _HTTP_UNPROCESSABLE,
        "{who} rejected your API key. Check or replace it in Settings → API access.",
    ),
    _HTTP_NOT_FOUND: (
        _HTTP_UNPROCESSABLE,
        (
            "{who} returned 404 for the configured endpoint or model. "
            "Check both in Settings → API access."
        ),
    ),
}


def describe_llm_error(exc: Exception, connection: LLMConnection | None) -> tuple[int, str]:
    """
    Map an upstream failure to an (HTTP status, user-facing detail) pair that
    names the user's own provider instead of hardcoding OpenAI.

    Kept here rather than duplicated across the four route modules so the copy
    stays consistent and provider-neutral.
    """
    who = connection.provider_label if connection else "your AI provider"

    # Our own errors already carry actionable, provider-aware copy.
    if isinstance(exc, LLMConnectionError | LLMResponseFormatError):
        status_code = (
            _HTTP_UNPROCESSABLE if isinstance(exc, LLMConnectionError) else _HTTP_BAD_GATEWAY
        )
        return status_code, str(exc)

    for error_type, status_code, template in _ERROR_RULES:
        if isinstance(exc, error_type):
            return status_code, template.format(who=who)

    if isinstance(exc, APIStatusError):
        rule = _STATUS_RULES.get(exc.status_code)
        if rule is not None:
            return rule[0], rule[1].format(who=who)
        return _HTTP_BAD_GATEWAY, f"{who} returned an error ({exc.status_code})."

    if isinstance(exc, OpenAIError):
        return _HTTP_BAD_GATEWAY, f"{who} returned an unexpected error."
    return _HTTP_BAD_GATEWAY, f"The request to {who} failed. Please try again."
