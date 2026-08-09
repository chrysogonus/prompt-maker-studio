"""
Per-(provider, model) estimated USD pricing, expressed as dollars per 1M tokens.

LiteLLM's community-maintained model index is the primary source, fetched from a
*pinned revision* (see _LITELLM_PRICING_REVISION) rather than a mutable branch,
and switchable off entirely with LLM_PRICING_REFRESH=false for a deployment that
wants no outbound traffic beyond its own provider and SMTP server. The known-good
table retained here is a fallback for missing entries or an unavailable index,
and the only source when refresh is disabled.
Self-hosted inference is always priced at zero, and unknown pairs remain
unpriced so catalogue callers can distinguish "unknown" from genuinely free.

Rates deliberately remain estimates rather than a billing engine: caching,
batch, residency, temporary-discount, and long-context tiers are not modelled.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
import os
from threading import Lock
import time

import httpx

Rates = dict[str, float]

logger = logging.getLogger(__name__)

# Pinned to a specific revision rather than `main`. This response decides the
# prices shown to users and, when a ceiling is configured, feeds budget
# accounting — taking whatever a mutable branch serves today makes both
# unreproducible and trusts an upstream default branch implicitly. Bump the
# revision deliberately, in a commit, the same as any other dependency.
_LITELLM_PRICING_REVISION = "v1.96.0-rc.1"
_LITELLM_PRICING_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/"
    f"{_LITELLM_PRICING_REVISION}/model_prices_and_context_window.json"
)
_PRICING_CACHE_TTL_SECONDS = 24 * 60 * 60
_PRICING_FETCH_TIMEOUT_SECONDS = 10.0
_PER_TOKEN_TO_PER_MILLION = 1_000_000

# Verified against LiteLLM's live index: the public Gemini Developer API uses
# `gemini`, while Vertex AI entries use a separate provider discriminator.
_LITELLM_PROVIDER_MAP = {
    "openai": "openai",
    "gemini": "gemini",
    "anthropic": "anthropic",
}

# Last checked 2026-07-26. These values are deliberately retained as the
# fallback tier when LiteLLM is unavailable or lacks a provider/model pair.
FALLBACK_PRICING: dict[tuple[str, str], Rates] = {
    ("openai", "gpt-4o-mini"): {"input": 0.15, "output": 0.60},
    ("openai", "gpt-4.1-mini-2025-04-14"): {"input": 0.40, "output": 1.60},
    ("openai", "gpt-4o"): {"input": 2.50, "output": 10.00},
    ("anthropic", "claude-opus-5"): {"input": 5.00, "output": 25.00},
    # Standard rate. Introductory pricing of $2/$10 applies through
    # 2026-08-31, so this over-estimates until then.
    ("anthropic", "claude-sonnet-5"): {"input": 3.00, "output": 15.00},
    ("anthropic", "claude-haiku-4-5-20251001"): {"input": 1.00, "output": 5.00},
    ("gemini", "gemini-3.6-flash"): {"input": 1.50, "output": 7.50},
    ("gemini", "gemini-3.5-flash-lite"): {"input": 0.30, "output": 2.50},
    # Prompts over 200k tokens are billed at a higher tier ($4/$18); the
    # sub-200k rate is used, since this app's prompts sit far below that.
    ("gemini", "gemini-3.1-pro"): {"input": 2.00, "output": 12.00},
}

# Providers whose inference the user runs themselves — never billed per token.
_FREE_PROVIDERS = frozenset({"ollama", "vllm"})


@dataclass
class _PricingCache:
    index: dict[tuple[str, str], Rates] | None = field(default=None)
    expires_at: float = 0.0


_pricing_cache = _PricingCache()
_pricing_cache_lock = Lock()


def pricing_refresh_enabled() -> bool:
    """Whether to fetch published prices from the network at all.

    A self-hoster who expects outbound traffic only to their own LLM provider
    and SMTP server is entitled to know this exists and to switch it off. With
    it off, pricing falls back to the compiled-in FALLBACK_PRICING snapshot:
    fewer models are priced, and spend figures for the rest are estimates from
    whenever that snapshot was last updated.
    """
    return os.getenv("LLM_PRICING_REFRESH", "true").strip().lower() not in {"false", "0", "no"}


def pricing_source_url() -> str:
    """The pricing document URL, overridable for an air-gapped mirror."""
    return os.getenv("LLM_PRICING_URL", "").strip() or _LITELLM_PRICING_URL


def _fetch_pricing_json() -> dict[str, object]:
    """Fetch LiteLLM's pricing document at the one patchable HTTP call site."""
    response = httpx.get(pricing_source_url(), timeout=_PRICING_FETCH_TIMEOUT_SECONDS)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        msg = "LiteLLM pricing response is not a JSON object"
        raise TypeError(msg)
    return payload


def _per_million(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
        return None
    # Normalise binary-float artefacts (for example 2e-7 * 1e6) before these
    # values become user-visible API prices.
    return round(float(value) * _PER_TOKEN_TO_PER_MILLION, 12)


def _build_index(payload: dict[str, object]) -> dict[tuple[str, str], Rates]:
    """Convert LiteLLM's per-token records into this app's provider/model index."""
    index: dict[tuple[str, str], Rates] = {}
    for raw_model, raw_entry in payload.items():
        if not isinstance(raw_model, str) or not isinstance(raw_entry, dict):
            continue

        provider = _LITELLM_PROVIDER_MAP.get(raw_entry.get("litellm_provider"))
        input_rate = _per_million(raw_entry.get("input_cost_per_token"))
        output_rate = _per_million(raw_entry.get("output_cost_per_token"))
        if provider is None or input_rate is None or output_rate is None:
            continue

        rates = {"input": input_rate, "output": output_rate}
        index[(provider, raw_model)] = rates
        # Provider responses usually return the bare id, even when LiteLLM's
        # key is namespaced (for example `gemini/gemini-2.5-flash`).
        bare_model = raw_model.rsplit("/", 1)[-1]
        index.setdefault((provider, bare_model), rates)
    return index


def _reset_pricing_cache() -> None:
    """Clear all pricing state for test isolation."""
    with _pricing_cache_lock:
        _pricing_cache.index = None
        _pricing_cache.expires_at = 0.0


def _live_pricing_index() -> dict[tuple[str, str], Rates]:
    if not pricing_refresh_enabled():
        return {}

    now = time.monotonic()
    with _pricing_cache_lock:
        if _pricing_cache.index is not None and _pricing_cache.expires_at > now:
            return _pricing_cache.index

        try:
            refreshed = _build_index(_fetch_pricing_json())
        except Exception as exc:
            # Keep an expired last-good value and its original expiry. The next
            # call retries immediately instead of treating failure as a refresh.
            logger.warning("Could not refresh LiteLLM pricing; serving stale data: %s", exc)
            return _pricing_cache.index or {}

        _pricing_cache.index = refreshed
        _pricing_cache.expires_at = time.monotonic() + _PRICING_CACHE_TTL_SECONDS
        return _pricing_cache.index


def rates_for(provider: str, model: str) -> Rates | None:
    """Published rates for a (provider, model) pair, or None if unpriced."""
    if provider in _FREE_PROVIDERS:
        return {"input": 0.0, "output": 0.0}
    return _live_pricing_index().get((provider, model)) or FALLBACK_PRICING.get((provider, model))


# Used only when a spend ceiling is configured and the real figures are
# unavailable: an unpriced hosted model, or a compat endpoint that returned no
# usage block. Both used to resolve to $0, which let a cap be bypassed
# indefinitely — every call "cost" nothing, so the ledger never approached the
# limit. Deliberately towards the expensive end of current hosted pricing so the
# unknown case errs against the budget rather than in favour of spending.
FALLBACK_RATES_USD_PER_MILLION = {"input": 15.0, "output": 75.0}
ASSUMED_TOKENS_WHEN_USAGE_MISSING = {"input": 2_000, "output": 2_000}


def is_priced(provider: str, model: str) -> bool:
    """Whether real published rates exist for this pair.

    Self-hosted providers count as priced: they genuinely cost nothing per
    token, which is a known rate rather than a missing one.
    """
    return rates_for(provider, model) is not None


def cost_usd_for(
    provider: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    *,
    assume_cost_when_unknown: bool = False,
) -> float:
    """Compute a call's USD cost.

    An unpriced pair costs 0.0 unless `assume_cost_when_unknown` is set, in
    which case a deliberately pessimistic rate is applied instead — see
    FALLBACK_RATES_USD_PER_MILLION. Callers set it when a budget ceiling is
    configured, so "we do not know" cannot read as "free".
    """
    rates = rates_for(provider, model)
    if rates is None:
        if not assume_cost_when_unknown:
            return 0.0
        rates = FALLBACK_RATES_USD_PER_MILLION
    return (prompt_tokens / 1_000_000) * rates["input"] + (completion_tokens / 1_000_000) * rates[
        "output"
    ]
