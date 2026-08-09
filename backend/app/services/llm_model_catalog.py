"""Live, per-user model catalogues enriched with estimated token pricing."""

from __future__ import annotations

import logging
from threading import Lock
import time

from app.models.user import User
from app.services.llm_client import LLMConnection
from app.services.llm_pricing import rates_for

logger = logging.getLogger(__name__)

_LIVE_LISTING_PROVIDERS = frozenset({"openai", "gemini", "ollama", "vllm"})
_MODEL_CACHE_TTL_SECONDS = 15 * 60

_model_cache: dict[int, tuple[float, tuple[str, ...]]] = {}
_model_cache_lock = Lock()


def invalidate_model_cache(user_id: int) -> None:
    """Discard one user's cached catalogue after their connection changes."""
    with _model_cache_lock:
        _model_cache.pop(user_id, None)


def _reset_model_cache() -> None:
    """Clear all catalogue state for test isolation."""
    with _model_cache_lock:
        _model_cache.clear()


def _list_model_ids(connection: LLMConnection) -> list[str]:
    """Call the provider's OpenAI-compatible model-list endpoint once."""
    response = connection.client.models.list()
    data = getattr(response, "data", None)
    if data is None:
        msg = "Provider model-list response has no data collection"
        raise TypeError(msg)

    model_ids: list[str] = []
    seen: set[str] = set()
    for model in data:
        model_id = getattr(model, "id", None)
        if isinstance(model_id, str) and model_id and model_id not in seen:
            seen.add(model_id)
            model_ids.append(model_id)
    return model_ids


def _uncached_model_ids(user: User, connection: LLMConnection) -> list[str]:
    provider = connection.provider
    if provider.handle not in _LIVE_LISTING_PROVIDERS:
        return list(provider.models)

    try:
        return _list_model_ids(connection)
    except Exception as exc:
        logger.warning(
            "Could not list models for provider %s and user %s; using static suggestions: %s",
            provider.handle,
            user.id,
            exc,
        )
        return list(provider.models)


def _cached_model_ids(user: User, connection: LLMConnection) -> list[str]:
    now = time.monotonic()
    with _model_cache_lock:
        cached = _model_cache.get(user.id)
        if cached is not None and cached[0] > now:
            return list(cached[1])

    model_ids = _uncached_model_ids(user, connection)
    with _model_cache_lock:
        _model_cache[user.id] = (
            time.monotonic() + _MODEL_CACHE_TTL_SECONDS,
            tuple(model_ids),
        )
    return model_ids


def model_catalog_for(user: User, connection: LLMConnection) -> list[dict[str, object]]:
    """Return the caller's cached model list with current estimated pricing."""
    catalogue: list[dict[str, object]] = []
    for model_id in _cached_model_ids(user, connection):
        rates = rates_for(connection.provider_handle, model_id)
        catalogue.append(
            {
                "id": model_id,
                "input_price_per_1m": rates["input"] if rates else None,
                "output_price_per_1m": rates["output"] if rates else None,
            }
        )
    return catalogue
