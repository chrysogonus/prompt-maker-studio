"""Schemas for the unauthenticated public tools under /api/public."""

from app.schemas.connections import ModelPriceInfo


class PublicModelPrice(ModelPriceInfo):
    """One curated hosted model with its provider and estimated token pricing."""

    provider: str
    provider_label: str
