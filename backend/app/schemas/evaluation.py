"""Evaluation request and response contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.accounts import (
    _MAX_EVAL_VARIABLE_NAME_LENGTH,
    _MAX_EVAL_VARIABLE_VALUE_LENGTH,
    _MAX_EVAL_VARIABLES,
)

MAX_EVAL_CASES_PER_PROMPT = 20


def _validate_eval_variables(variables: dict[str, str]) -> dict[str, str]:
    """Cap variable count/size — this text is sent to a paid external API."""
    if len(variables) > _MAX_EVAL_VARIABLES:
        msg = f"Too many variables (max {_MAX_EVAL_VARIABLES})"
        raise ValueError(msg)
    for name, value in variables.items():
        if (
            len(name) > _MAX_EVAL_VARIABLE_NAME_LENGTH
            or len(value) > _MAX_EVAL_VARIABLE_VALUE_LENGTH
        ):
            msg = f"Variable '{name}' exceeds allowed size"
            raise ValueError(msg)
    return variables


class EvalCaseCreateRequest(BaseModel):
    """Schema for POST /api/prompts/{id}/eval/cases."""

    method: Literal["rule", "judge", "manual"] = Field(
        ..., description="Scoring method for this test case"
    )
    name: str | None = Field(None, max_length=100)
    criteria: str | None = Field(
        None,
        max_length=2000,
        description=(
            "Rule: comma-separated checks — plain substring, !forbidden, "
            "~regex, or {json}; commas inside brackets are literal. "
            "Judge: a grading instruction. Manual: unused."
        ),
    )
    variables: dict[str, str] = Field(
        default_factory=dict, description="Values for the template's {{variable}} placeholders"
    )
    intentionally_empty: bool = False

    @field_validator("variables")
    @classmethod
    def validate_variables_size(cls, variables: dict[str, str]) -> dict[str, str]:
        return _validate_eval_variables(variables)


class EvalCaseUpdateRequest(BaseModel):
    """Schema for PATCH /api/prompts/{id}/eval/cases/{case_id}. All fields optional."""

    method: Literal["rule", "judge", "manual"] | None = None
    name: str | None = Field(None, max_length=100)
    criteria: str | None = Field(None, max_length=2000)
    variables: dict[str, str] | None = None
    intentionally_empty: bool | None = None

    @field_validator("variables")
    @classmethod
    def validate_variables_size(cls, variables: dict[str, str] | None) -> dict[str, str] | None:
        if variables is None:
            return None
        return _validate_eval_variables(variables)


class EvalCaseResponse(BaseModel):
    """Schema for a single eval case."""

    id: int
    prompt_id: int
    method: Literal["rule", "judge", "manual"]
    name: str | None
    criteria: str | None
    variables: dict[str, str]
    intentionally_empty: bool
    position: int
    created_at: datetime

    class Config:
        from_attributes = True


class EvalRunResultResponse(BaseModel):
    """Schema for a single case's outcome within an eval run."""

    id: int
    eval_case_id: int | None
    method: Literal["rule", "judge", "manual"]
    label: str
    rationale: str | None
    score: float | None
    is_pending: bool
    output_text: str | None
    # Snapshot of the case's criteria/variables at run time, and the judge
    # model actually used (judge method only) — see EvalRunResult model.
    criteria: str | None = None
    variables: dict[str, str] | None = None
    judge_model: str | None = None

    class Config:
        from_attributes = True


class EvalRunResponse(BaseModel):
    """Schema for a single evaluation run and its per-case results."""

    id: int
    prompt_id: int
    prompt_version_number: int
    score: float | None
    created_at: datetime
    results: list[EvalRunResultResponse]
    # Reproducibility metadata: resolved execution model, and aggregated
    # cost/latency/tokens across every case run + judge grading call.
    model: str = ""
    total_latency_ms: int = 0
    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    total_cost_usd: float = 0.0

    class Config:
        from_attributes = True


class EvalRunRateRequest(BaseModel):
    """Schema for submitting a manual star rating for a pending eval result."""

    stars: int = Field(..., ge=1, le=5, description="1-5 star rating, mapped to a 0-100 score")


class EvalCaseGenerateRequest(BaseModel):
    """Schema for POST /api/prompts/{id}/eval/cases/generate."""

    goal: str | None = Field(
        None, max_length=500, description="Optional testing focus, e.g. 'edge cases around dates'"
    )


class EvalCaseProposalResponse(BaseModel):
    """Schema for a single AI-proposed eval case — not yet persisted."""

    method: Literal["rule", "judge", "manual"]
    name: str = Field("", max_length=100, description="Short label for the proposed case")
    criteria: str | None
    variables: dict[str, str]
    rationale: str

    class Config:
        from_attributes = True


class EvalCaseGenerateResponse(BaseModel):
    """Schema for the AI-assisted eval set generator's response."""

    proposals: list[EvalCaseProposalResponse]
