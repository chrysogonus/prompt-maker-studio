"""Refinement request and response contracts."""

from pydantic import BaseModel, Field, field_validator

from app.schemas.prompts import PromptField, _require_unique_section_tags


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


class RefineSnapshotRequest(BaseModel):
    """Current editor sections; refinement never saves this snapshot."""

    fields: list[PromptField] = Field(..., min_length=1, max_length=100)

    @field_validator("fields")
    @classmethod
    def validate_section_names(cls, fields: list[PromptField]) -> list[PromptField]:
        return _require_unique_section_tags(fields)


class RefineSnapshotQuestionsRequest(RefineSnapshotRequest):
    force: bool = False


class RefineSnapshotDraftRequest(RefineSnapshotRequest):
    # No questions at all asks for an improvement without clarifications.
    qa_pairs: list[RefineQAPair] = Field(default_factory=list, max_length=10)

    @field_validator("qa_pairs")
    @classmethod
    def require_answer(cls, pairs: list[RefineQAPair]) -> list[RefineQAPair]:
        if pairs and not any(pair.answer.strip() for pair in pairs):
            message = "Answer at least one question before creating a draft"
            raise ValueError(message)
        return pairs


class RefineSnapshotDraftResponse(BaseModel):
    fields: list[PromptField]
