"""
Registry of the LLM providers a user can connect their own account to.

Every provider here is reached through its OpenAI-compatible chat-completions
endpoint using the `openai` SDK with a per-provider `base_url` — see
product/DECISIONS.md ("Bring-your-own LLM provider over an OpenAI-compatible
transport"). No native provider SDKs are involved.

The per-provider `structured_output` capability matters because the four
services that need machine-readable JSON back cannot assume OpenAI's strict
`response_format` schema works everywhere: Anthropic's compatibility layer
*silently ignores* `response_format` (documented, not an error), and Ollama
only honours the coarse `json_object` form. `services/llm_client.py` therefore
always puts the schema in the prompt and treats `response_format` as an
optimisation on top.
"""

from __future__ import annotations

from dataclasses import dataclass
import ipaddress
import os
import socket
from urllib.parse import urlparse

# How a provider handles `response_format`, worst case first.
STRUCTURED_NONE = "none"  # ignored or rejected — prompt-only JSON
STRUCTURED_JSON_OBJECT = "json_object"  # honours {"type": "json_object"}
STRUCTURED_JSON_SCHEMA = "json_schema"  # honours a strict JSON schema


@dataclass(frozen=True)
class Provider:
    """One selectable provider and everything the app needs to talk to it."""

    handle: str
    label: str
    # None means the user must supply one (self-hosted / gateway endpoints).
    default_base_url: str | None
    # Local inference servers accept any key (or none), so we don't demand one.
    requires_api_key: bool
    structured_output: str
    # Suggested models for the picker. Free text is still accepted, because a
    # self-hosted server can serve any model name at all.
    models: tuple[str, ...] = ()
    # Local servers are routinely far slower than a hosted API for the same
    # prompt, so they get a longer per-request ceiling.
    timeout_seconds: float = 30.0
    docs_url: str | None = None

    @property
    def is_local(self) -> bool:
        return not self.requires_api_key


PROVIDERS: dict[str, Provider] = {
    "openai": Provider(
        handle="openai",
        label="OpenAI",
        default_base_url="https://api.openai.com/v1",
        requires_api_key=True,
        structured_output=STRUCTURED_JSON_SCHEMA,
        models=("gpt-4o-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o"),
        docs_url="https://platform.openai.com/api-keys",
    ),
    "anthropic": Provider(
        handle="anthropic",
        label="Anthropic",
        default_base_url="https://api.anthropic.com/v1/",
        requires_api_key=True,
        # Anthropic's OpenAI compatibility layer documents `response_format`
        # as *ignored* — sending it produces prose, not an error, so the
        # schema has to travel in the prompt instead.
        structured_output=STRUCTURED_NONE,
        models=("claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"),
        docs_url="https://platform.claude.com/docs/en/api/openai-sdk",
    ),
    "gemini": Provider(
        handle="gemini",
        label="Google Gemini",
        default_base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        requires_api_key=True,
        structured_output=STRUCTURED_JSON_SCHEMA,
        models=("gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro"),
        docs_url="https://ai.google.dev/gemini-api/docs/openai",
    ),
    "ollama": Provider(
        handle="ollama",
        label="Ollama (self-hosted)",
        default_base_url="http://localhost:11434/v1",
        requires_api_key=False,
        # Ollama maps `json_object` onto its native `format: json`; its
        # `json_schema` handling is incomplete (ollama/ollama#10001).
        structured_output=STRUCTURED_JSON_OBJECT,
        models=(),
        timeout_seconds=180.0,
        docs_url="https://docs.ollama.com/api/openai-compatibility",
    ),
    "vllm": Provider(
        handle="vllm",
        label="vLLM (self-hosted)",
        default_base_url="http://localhost:8000/v1",
        requires_api_key=False,
        structured_output=STRUCTURED_JSON_SCHEMA,
        models=(),
        timeout_seconds=180.0,
        docs_url="https://docs.vllm.ai/en/latest/serving/online_serving/",
    ),
    "custom": Provider(
        handle="custom",
        label="Custom OpenAI-compatible endpoint",
        default_base_url=None,
        requires_api_key=False,
        # Unknown gateway: assume the least and rely on prompt-only JSON.
        structured_output=STRUCTURED_NONE,
        models=(),
        timeout_seconds=120.0,
    ),
}

PROVIDER_HANDLES: tuple[str, ...] = tuple(PROVIDERS)

_ALLOWED_URL_SCHEMES = ("http", "https")
MAX_BASE_URL_LENGTH = 500
MAX_MODEL_LENGTH = 200
MAX_API_KEY_LENGTH = 500


class InvalidConnectionError(ValueError):
    """A user-supplied connection setting failed validation; message is user-safe."""


def get_provider(handle: str) -> Provider:
    """Look up a provider by handle, raising a user-safe error for unknown ones."""
    provider = PROVIDERS.get(handle)
    if provider is None:
        known = ", ".join(PROVIDER_HANDLES)
        msg = f"Unknown provider '{handle}'. Choose one of: {known}."
        raise InvalidConnectionError(msg)
    return provider


def private_llm_urls_allowed() -> bool:
    """Whether a user may point the backend at a private-network address.

    Off by default. A base URL becomes a server-side request target, so with
    open registration this is an SSRF primitive: any visitor who can create an
    account could make the backend reach Docker-internal services, loopback
    listeners, RFC1918 hosts, and cloud metadata endpoints, and read some of
    what came back. Self-hosting Ollama or vLLM on the same network is a real
    use case, so operators can opt in — but that is a decision about who they
    trust to hold an account, not a safe default to ship.
    """
    return os.getenv("ALLOW_PRIVATE_LLM_URLS", "false").strip().lower() in {"true", "1", "yes"}


def _is_blocked_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Addresses no user-supplied endpoint should resolve to."""
    if address.is_private or address.is_loopback or address.is_link_local:
        return True
    if address.is_multicast or address.is_reserved or address.is_unspecified:
        return True
    # 169.254.169.254 and friends are link-local, already covered above; this
    # catches IPv6-mapped IPv4 forms that would otherwise slip past.
    mapped = getattr(address, "ipv4_mapped", None)
    return bool(mapped is not None and _is_blocked_address(mapped))


def assert_public_host(host: str) -> None:
    """Resolve `host` and reject it if any answer is a private destination.

    Every address is checked, not just the first: a name that resolves to one
    public and one internal address would otherwise pass validation and then be
    connected to internally. This is validation, not a guarantee — DNS can
    change between this check and the request (rebinding), which is why the
    operator-facing guidance is to pair it with network-level egress rules.
    """
    if private_llm_urls_allowed():
        return

    try:
        resolved = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        msg = f"Could not resolve host '{host}'. Check the base URL."
        raise InvalidConnectionError(msg) from exc

    for entry in resolved:
        try:
            address = ipaddress.ip_address(entry[4][0])
        except ValueError:  # pragma: no cover - getaddrinfo returns valid literals
            continue
        if _is_blocked_address(address):
            msg = (
                f"Base URL host '{host}' resolves to a private or loopback address, which this "
                "deployment does not allow. An operator can permit local providers such as "
                "Ollama or vLLM by setting ALLOW_PRIVATE_LLM_URLS=true."
            )
            raise InvalidConnectionError(msg)


def validate_base_url(raw: str) -> str:
    """
    Normalise and sanity-check a user-supplied base URL.

    This URL becomes a server-side request target, so it is validated at the
    boundary: http/https only, a real host, no embedded credentials (which
    would smuggle a secret into logs), and — unless the operator opted in via
    ALLOW_PRIVATE_LLM_URLS — a host that does not resolve into private address
    space. See `assert_public_host` and SECURITY.md.
    """
    candidate = raw.strip()
    if not candidate:
        msg = "Base URL cannot be empty."
        raise InvalidConnectionError(msg)
    if len(candidate) > MAX_BASE_URL_LENGTH:
        msg = f"Base URL is too long (max {MAX_BASE_URL_LENGTH} characters)."
        raise InvalidConnectionError(msg)

    parsed = urlparse(candidate)
    if parsed.scheme not in _ALLOWED_URL_SCHEMES:
        msg = "Base URL must start with http:// or https://."
        raise InvalidConnectionError(msg)
    if not parsed.hostname:
        msg = "Base URL must include a host, e.g. http://localhost:11434/v1."
        raise InvalidConnectionError(msg)
    if parsed.username or parsed.password:
        msg = "Base URL must not embed a username or password — use the API key field."
        raise InvalidConnectionError(msg)
    if parsed.query or parsed.fragment:
        msg = "Base URL must not include a query string or fragment."
        raise InvalidConnectionError(msg)

    assert_public_host(parsed.hostname)

    # Trailing slashes are harmless to the SDK but make stored values differ
    # for what is the same endpoint; normalise so comparisons behave.
    return candidate.rstrip("/") or candidate


@dataclass(frozen=True)
class ResolvedConnection:
    """A validated, ready-to-store provider connection."""

    provider: Provider
    base_url: str
    model: str
    # None means "leave whatever key is already stored alone".
    api_key: str | None = None


def resolve_connection(
    *,
    provider_handle: str,
    base_url: str | None,
    model: str,
    api_key: str | None,
    has_stored_key: bool,
) -> ResolvedConnection:
    """
    Validate a connection the user is trying to save.

    `api_key=None` means "leave the stored key alone"; `has_stored_key` says
    whether that would still leave the connection usable. Callers must pass
    `has_stored_key=False` when the provider handle is changing, so switching
    vendors without re-entering a key fails loudly rather than silently
    presenting one vendor's credential to another.
    """
    provider = get_provider(provider_handle)

    resolved_url = validate_base_url(base_url) if base_url else provider.default_base_url
    if not resolved_url:
        msg = f"{provider.label} requires a base URL, e.g. http://localhost:11434/v1."
        raise InvalidConnectionError(msg)

    normalized_model = model.strip()
    if not normalized_model:
        msg = "Model is required — enter the model name your provider serves."
        raise InvalidConnectionError(msg)
    if len(normalized_model) > MAX_MODEL_LENGTH:
        msg = f"Model name is too long (max {MAX_MODEL_LENGTH} characters)."
        raise InvalidConnectionError(msg)

    normalized_key = api_key.strip() if api_key is not None else None
    if normalized_key is not None and len(normalized_key) > MAX_API_KEY_LENGTH:
        msg = f"API key is too long (max {MAX_API_KEY_LENGTH} characters)."
        raise InvalidConnectionError(msg)
    if provider.requires_api_key and not (normalized_key or has_stored_key):
        msg = f"{provider.label} requires an API key."
        raise InvalidConnectionError(msg)

    return ResolvedConnection(
        provider=provider,
        base_url=resolved_url,
        model=normalized_model,
        api_key=normalized_key,
    )
