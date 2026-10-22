"""Schemas for the unauthenticated public tools under /api/public."""

from pydantic import BaseModel, Field, field_validator

from app.schemas.connections import ModelPriceInfo
from app.schemas.refinement import RefineQAPair


class PublicModelPrice(ModelPriceInfo):
    """One curated hosted model with its provider and estimated token pricing."""

    provider: str
    provider_label: str


PUBLIC_REFINE_MAX_CHARS = 8000


class PublicRefineRequest(BaseModel):
    """A pasted prompt from a signed-out visitor, refined as one Task section."""

    text: str = Field(..., min_length=1, max_length=PUBLIC_REFINE_MAX_CHARS)
    # Honeypot: hidden from people, so anything in it came from a bot filling every field.
    website: str = Field("", max_length=200)

    @field_validator("text")
    @classmethod
    def require_text(cls, text: str) -> str:
        if not text.strip():
            msg = "Paste a prompt to refine."
            raise ValueError(msg)
        return text

    @field_validator("website")
    @classmethod
    def reject_filled_honeypot(cls, website: str) -> str:
        if website:
            msg = "This request cannot be processed."
            raise ValueError(msg)
        return website


class PublicRefineQuestionsRequest(PublicRefineRequest):
    """Schema for POST /api/public/refine/questions."""

    force: bool = False


class PublicRefineDraftRequest(PublicRefineRequest):
    """Schema for POST /api/public/refine/draft."""

    qa_pairs: list[RefineQAPair] = Field(default_factory=list, max_length=5)


class PublicRefineDraftResponse(BaseModel):
    """The refined prompt text."""

    text: str


class PublicRefineStatus(BaseModel):
    """Whether this server offers the free refiner, and its input limit."""

    available: bool
    max_chars: int = PUBLIC_REFINE_MAX_CHARS
