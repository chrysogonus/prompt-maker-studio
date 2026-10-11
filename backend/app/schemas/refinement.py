"""Refinement request and response contracts."""

from pydantic import BaseModel, Field


class RefineQAPair(BaseModel):
    """A single clarifying question and the user's answer."""

    question: str = Field(..., min_length=1, max_length=500)
    answer: str = Field(..., max_length=2000)


class RefineDraftRequest(BaseModel):
    """Schema for POST /api/prompts/{id}/refine/draft."""

    qa_pairs: list[RefineQAPair] = Field(..., min_length=1, max_length=10)


class RefineQuestionsResponse(BaseModel):
    """Schema for POST /api/prompts/{id}/refine/questions."""

    questions: list[str]


class RefineDraftResponse(BaseModel):
    """Schema for a generated draft revision."""

    draft: str
