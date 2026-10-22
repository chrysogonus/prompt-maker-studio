"""
The single place an LLM client is constructed.

Every AI feature (AI import, refine questions/draft, Playground runs, eval case
runs, judge grading, eval-case generation) resolves its client from the acting
user's own provider connection through `client_for()`. A user without a usable
connection of their own falls back to the operator's server default (LLM_*
env vars), when one is set. There is no other `OpenAI(...)` construction in
`app/`.

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
from urllib.parse import urlsplit

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    DefaultHttpx2Client,
    NotFoundError,
    OpenAI,
    OpenAIError,
    PermissionDeniedError,
    RateLimitError,
)

from app.metrics import provider_attempt
from app.models.user import User
from app.services.llm_providers import (
    STRUCTURED_JSON_OBJECT,
    STRUCTURED_JSON_SCHEMA,
    STRUCTURED_NONE,
    Provider,
    get_provider,
    private_llm_urls_allowed,
)
from app.services.llm_transport import PublicLLMTransport
from app.services.secret_store import SecretDecryptionError, decrypt_secret
from app.services.spend_ledger import LLMUsage, capture_response_usage

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


@dataclass(frozen=True)
class ServerDefault:
    """The deployment-wide connection from LLM_* env vars, used by anyone
    without a usable connection of their own."""

    provider: Provider
    base_url: str
    model: str
    api_key: str


def server_default() -> ServerDefault | None:
    """
    The operator's LLM_BASE_URL/LLM_MODEL connection, or None when unset.

    The operator configures this URL, not a user, so it deliberately bypasses
    the egress policy for user-supplied URLs (ALLOW_PRIVATE_LLM_URLS).
    """
    base_url = os.getenv("LLM_BASE_URL", "").strip()
    model = os.getenv("LLM_MODEL", "").strip()
    if not base_url or not model:
        return None
    handle = os.getenv("LLM_PROVIDER", "").strip() or "custom"
    try:
        provider = get_provider(handle)
    except ValueError:
        logger.warning("Ignoring the server default LLM: unknown LLM_PROVIDER=%r", handle)
        return None
    return ServerDefault(
        provider=provider,
        base_url=base_url,
        model=model,
        api_key=os.getenv("LLM_API_KEY", "").strip(),
    )


def has_own_connection(user: User) -> bool:
    """Whether `user` has saved a connection of their own that every AI feature
    could actually use — ignoring the server default."""
    if not user.llm_provider or not user.llm_model:
        return False
    try:
        provider = get_provider(user.llm_provider)
    except ValueError:
        return False
    if provider.requires_api_key and not user.llm_api_key_encrypted:
        return False
    return bool(user.llm_base_url or provider.default_base_url)


def active_provider_and_model(user: User) -> tuple[Provider, str] | None:
    """The provider and model `user`'s AI features run against — their own
    connection first, then the server default — or None if neither exists."""
    if has_own_connection(user):
        return get_provider(user.llm_provider), user.llm_model
    default = server_default()
    return (default.provider, default.model) if default else None


def available_models_for(user: User) -> list[str]:
    """Curated hosted choices, or the user's configured custom/local model.

    Legacy hosted models remain runnable via client_for but are not advertised
    as choices for new connections.
    """
    if not has_own_connection(user):
        default = server_default()
        return [default.model] if default else []
    provider = get_provider(user.llm_provider)
    return list(provider.models) if provider.models else [user.llm_model]


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


def server_default_connection(model: str | None = None) -> LLMConnection | None:
    """The operator's shared connection, or None when the server has none. Used for
    users without their own connection and for signed-out visitors (the free refiner)."""
    default = server_default()
    if default is None:
        return None
    return _build_connection(
        default.provider,
        (model or default.model).strip(),
        default.base_url,
        default.api_key or _LOCAL_API_KEY_PLACEHOLDER,
        trusted=True,
    )


def client_for(user: User, model: str | None = None) -> LLMConnection:
    """
    Build the LLM client for `user`'s own provider connection, or for the
    server default when they have no usable connection of their own.

    Args:
        user: The acting user — their own connection always wins over the
            server default
        model: Optional override (e.g. the Playground's model picker); falls
            back to the connection's configured model

    Raises:
        NoProviderConfiguredError: If no usable connection is configured
        StoredKeyUnreadableError: If the stored key cannot be decrypted
    """
    if not has_own_connection(user):
        connection = server_default_connection(model)
        if connection is not None:
            return connection

    if not user.llm_provider:
        msg = (
            "No AI provider is connected. Add your provider and API key in "
            "Settings → AI connection to use AI features."
        )
        raise NoProviderConfiguredError(msg)

    try:
        provider = get_provider(user.llm_provider)
    except ValueError as exc:
        msg = (
            f"Your saved AI provider ('{user.llm_provider}') is no longer supported. "
            "Pick a provider again in Settings → AI connection."
        )
        raise NoProviderConfiguredError(msg) from exc

    resolved_model = (model or user.llm_model or "").strip()
    if not resolved_model:
        msg = (
            f"No model is configured for your {provider.label} connection. "
            "Set one in Settings → AI connection."
        )
        raise NoProviderConfiguredError(msg)

    base_url = user.llm_base_url or provider.default_base_url
    if not base_url:
        msg = f"Your {provider.label} connection has no base URL. Set one in Settings → AI connection."
        raise NoProviderConfiguredError(msg)

    if user.llm_api_key_encrypted:
        try:
            api_key = decrypt_secret(user.llm_api_key_encrypted)
        except SecretDecryptionError as exc:
            msg = (
                "Your stored API key could not be read (the server's encryption key changed). "
                "Re-enter it in Settings → AI connection."
            )
            raise StoredKeyUnreadableError(msg) from exc
    elif provider.requires_api_key:
        msg = f"No API key is configured for {provider.label}. Add one in Settings → AI connection."
        raise NoProviderConfiguredError(msg)
    else:
        api_key = _LOCAL_API_KEY_PLACEHOLDER

    return _build_connection(
        provider, resolved_model, base_url, api_key, workspace_id=user.llm_workspace_id
    )


def unsaved_connection(
    provider: Provider,
    model: str,
    base_url: str,
    api_key: str | None,
    workspace_id: str | None = None,
) -> LLMConnection:
    """A connection the user is checking in Settings before saving it. Never trusted:
    the egress policy for user-supplied URLs applies as for a saved connection."""
    return _build_connection(
        provider,
        model,
        base_url,
        api_key or _LOCAL_API_KEY_PLACEHOLDER,
        workspace_id=workspace_id,
    )


def _build_connection(
    provider: Provider,
    model: str,
    base_url: str,
    api_key: str,
    *,
    trusted: bool = False,
    workspace_id: str | None = None,
) -> LLMConnection:
    headers = {}
    if (
        provider.handle == "anthropic"
        and urlsplit(base_url).hostname == "api.anthropic.com"
        and workspace_id
    ):
        headers["anthropic-workspace-id"] = workspace_id
    public_only = not trusted and not private_llm_urls_allowed()
    http_client = DefaultHttpx2Client(
        # A redirect must not forward the workspace selector to another origin.
        follow_redirects=not public_only and not headers,
        trust_env=not public_only,
        **({"transport": PublicLLMTransport(trust_env=False)} if public_only else {}),
    )
    return LLMConnection(
        provider=provider,
        model=model,
        client=OpenAI(
            api_key=api_key,
            default_headers=headers,
            base_url=base_url,
            timeout=timeout_seconds_for(provider),
            # One retry only: the caller is inside a synchronous HTTP request
            # (or an eval worker with its own deadline), so the SDK's default
            # backoff budget would blow past the timeout the user is waiting on.
            max_retries=1,
            http_client=http_client,
        ),
    )


def usage_from(response, connection: LLMConnection) -> LLMUsage:
    """Token usage for one response. `usage` is absent on some compat
    endpoints, so both fields are guarded — spend accounting degrades to zero
    rather than raising."""
    usage = getattr(response, "usage", None)
    return capture_response_usage(
        LLMUsage(
            provider=connection.provider_handle,
            model=connection.model,
            prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
        )
    )


def text_completion(
    connection: LLMConnection, messages: list[dict[str, str]]
) -> tuple[str, LLMUsage]:
    """Plain chat completion — the Playground's unstructured path."""
    with provider_attempt(connection) as attempt:
        response = connection.client.chat.completions.create(
            model=connection.model,
            messages=messages,
        )
        attempt.usage = usage_from(response, connection)
    return _content_of(response), attempt.usage


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
            with provider_attempt(connection) as attempt:
                response = connection.client.chat.completions.create(
                    model=connection.model,
                    messages=messages,
                    **kwargs,
                )
                attempt.usage = usage_from(response, connection)
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

        attempt_usage = attempt.usage
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
        f"'{connection.model}'. Try a more capable model in Settings → AI connection."
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
        "{who} rejected your API key. Check or replace it in Settings → AI connection.",
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
            "Check it in Settings → AI connection."
        ),
    ),
    (APITimeoutError, _HTTP_BAD_GATEWAY, "{who} did not respond in time. Please try again."),
    (
        APIConnectionError,
        _HTTP_BAD_GATEWAY,
        (
            "Could not reach {who} at the configured base URL. "
            "Check the endpoint in Settings → AI connection."
        ),
    ),
)

_STATUS_RULES: dict[int, tuple[int, str]] = {
    _HTTP_UNAUTHORIZED: (
        _HTTP_UNPROCESSABLE,
        "{who} rejected your API key. Check or replace it in Settings → AI connection.",
    ),
    _HTTP_FORBIDDEN: (
        _HTTP_UNPROCESSABLE,
        "{who} rejected your API key. Check or replace it in Settings → AI connection.",
    ),
    _HTTP_NOT_FOUND: (
        _HTTP_UNPROCESSABLE,
        (
            "{who} returned 404 for the configured endpoint or model. "
            "Check both in Settings → AI connection."
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

    if (
        connection is not None
        and connection.provider_handle == "anthropic"
        and isinstance(exc, APIStatusError)
        and exc.status_code in (400, 401, 403, 404, 422)
        and "workspace" in str(exc).lower()
    ):
        return _HTTP_UNPROCESSABLE, (
            "Anthropic requires a valid workspace for this API key. "
            "Add or check the Anthropic workspace ID in Settings → AI connection, "
            "and confirm the key has access to that workspace."
        )

    for error_type, status_code, template in _ERROR_RULES:
        if isinstance(exc, error_type):
            return status_code, template.format(who=who)

    if isinstance(exc, APIStatusError):
        rule = _STATUS_RULES.get(exc.status_code)
        if rule is not None:
            return rule[0], rule[1].format(who=who)
        return _HTTP_BAD_GATEWAY, f"{who} returned an error ({exc.status_code})."

    detail = (
        f"{who} returned an unexpected error."
        if isinstance(exc, OpenAIError)
        else f"The request to {who} failed. Please try again."
    )
    return _HTTP_BAD_GATEWAY, detail
