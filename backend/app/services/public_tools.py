"""Data for the free tools signed-out visitors use; nothing here is user-scoped."""

from app.services.llm_model_catalog import model_prices_for
from app.services.llm_providers import PROVIDERS


def hosted_model_prices() -> list[dict[str, object]]:
    """Curated hosted models with estimated prices, for the token counter."""
    return [
        {**price, "provider": provider.handle, "provider_label": provider.label}
        for provider in PROVIDERS.values()
        if provider.models
        for price in model_prices_for(provider, provider.models)
    ]
