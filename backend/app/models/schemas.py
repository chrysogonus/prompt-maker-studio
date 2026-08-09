"""
Pydantic schemas for request/response validation.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

TagLabel = Annotated[str, Field(min_length=1, max_length=50)]


class VariableMetadataItem(BaseModel):
    """Type/description for a single `{{variable}}` detected in a prompt template."""

    type: Literal["text", "number", "boolean", "list"] = "text"
    description: str | None = Field(None, max_length=500)


class PromptField(BaseModel):
    """Schema for a single prompt field."""

    # Pattern enforces valid XML tag name characters: start with letter or underscore,
    # followed by letters, digits, underscores, or hyphens. This prevents malformed
    # XML output from the generator (e.g. names with spaces or angle brackets).
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z_][A-Za-z0-9_-]*$",
        description="Field name — must be a valid XML identifier (e.g. 'goal', 'my-style')",
    )
    content: str = Field(..., max_length=10_000, description="Field content")


class PromptRequest(BaseModel):
    """Schema for incoming prompt generation requests."""

    fields: list[PromptField] = Field(
        ..., min_length=1, max_length=100, description="Dynamic prompt fields"
    )
    name: str | None = Field(
        None, max_length=100, description="Optional name to save the prompt as"
    )

    @field_validator("fields")
    @classmethod
    def validate_field_names(cls, fields: list[PromptField]) -> list[PromptField]:
        """Ensure field names are unique."""
        names = [field.name for field in fields]
        if len(names) != len(set(names)):
            msg = "Field names must be unique"
            raise ValueError(msg)
        return fields


class PromptResponse(BaseModel):
    """Schema for prompt generation response."""

    id: int
    name: str | None
    generated_prompt: str
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class PromptHistoryResponse(BaseModel):
    """Schema for historical prompt data."""

    id: int
    name: str | None
    fields: list[PromptField]
    generated_prompt: str
    created_at: datetime
    updated_at: datetime | None = None
    folder: str | None = None
    is_favorite: bool = False
    tags: list[str] | None = None
    variable_metadata: dict[str, VariableMetadataItem] | None = None
    run_count: int = 0

    class Config:
        from_attributes = True


class PromptUpdateRequest(BaseModel):
    """Schema for updating an existing prompt (PATCH).

    All fields are optional — only provided fields are updated. As with
    `name`/`fields`/`generated_prompt`, `None` means "not provided"; to
    clear `folder`, `tags`, or `variable_metadata` explicitly, PATCH with
    `""` / `[]` / `{}`.
    """

    name: str | None = Field(None, max_length=100, description="New name for the saved prompt")
    fields: list[PromptField] | None = Field(
        None, max_length=100, description="Updated prompt fields"
    )
    generated_prompt: str | None = Field(
        None, max_length=50_000, description="Updated generated prompt text"
    )
    folder: str | None = Field(None, max_length=255, description="Organizational folder label")
    is_favorite: bool | None = Field(None, description="Whether the prompt is starred")
    tags: list[TagLabel] | None = Field(
        None, max_length=20, description="Tag labels for organization/filtering"
    )
    variable_metadata: dict[str, VariableMetadataItem] | None = Field(
        None, description="Type/description per detected template variable, keyed by name"
    )
    note: str | None = Field(
        None, max_length=255, description="Optional version-history note for this edit"
    )
    last_updated_at: datetime | None = Field(
        None, description="Timestamp of the last known update to detect concurrent edit conflicts"
    )


class PromptVersionResponse(BaseModel):
    """Schema for a single prompt version snapshot."""

    id: int
    version_number: int
    note: str | None
    author: str | None
    fields: list[PromptField]
    generated_prompt: str
    created_at: datetime


class DailyRequestCount(BaseModel):
    """Schema for a single day's entry in the Dashboard's 7-day request-volume series."""

    date: str
    count: int


class TopPromptUsage(BaseModel):
    """Schema for a single entry in the Dashboard's top-prompts-by-usage list."""

    prompt_id: int
    name: str
    run_count: int


class DashboardStatsResponse(BaseModel):
    """Schema for GET /api/analytics/dashboard.

    Fields are `None`/empty when there isn't yet enough data to compute
    them — never a fabricated placeholder number.
    """

    runs_this_month: int
    runs_change_pct: float | None
    avg_latency_ms: int | None
    success_rate_pct: float | None
    total_cost_usd: float
    avg_cost_per_run_usd: float | None
    request_volume_7d: list[DailyRequestCount]
    top_prompts: list[TopPromptUsage]


class ExportedPromptVersion(BaseModel):
    """Schema for a version snapshot within a data export."""

    version_number: int
    note: str | None
    author: str | None
    fields: list[PromptField]
    generated_prompt: str
    created_at: datetime


class ExportedPrompt(BaseModel):
    """Schema for a single prompt (with its version history) within a data export."""

    id: int
    name: str | None
    fields: list[PromptField]
    generated_prompt: str
    folder: str | None
    tags: list[str] | None
    is_favorite: bool
    created_at: datetime
    updated_at: datetime | None
    versions: list[ExportedPromptVersion]


class DataExportResponse(BaseModel):
    """Schema for GET /api/prompts/export — the full downloadable data dump."""

    exported_at: datetime
    prompts: list[ExportedPrompt]


class SmtpDiagnosticResponse(BaseModel):
    """Schema for SMTP diagnostic check responses."""

    ok: bool
    message: str


class PromptsConfigResponse(BaseModel):
    """Schema for GET /api/prompts/config — the calling user's AI capability state.

    Reports the *caller's own* bring-your-own provider connection, not a
    global env check: with per-user credentials, "can this app do AI right
    now" is a per-user question.
    """

    # False when the user has no usable connection — the frontend uses this to
    # show a "connect a provider" empty state rather than a broken feature.
    provider_connected: bool
    provider: str | None = None
    provider_label: str | None = None
    model: str | None = None
    # Suggested models for the caller's provider, their configured one first.
    # Empty when no connection is configured, so the frontend never advertises
    # a model it can't actually run.
    available_models: list[str] = Field(default_factory=list)
    # Global-only budget snapshot (see BudgetService.global_status).
    # `global_budget_remaining_usd` is None when no GLOBAL_MONTHLY_BUDGET_USD
    # ceiling is configured, mirroring `available_models`'s empty-list-when-
    # unconfigured convention.
    budget_exhausted: bool = False
    global_budget_remaining_usd: float | None = None


class LLMProviderOption(BaseModel):
    """One selectable provider, for the Settings connection form."""

    handle: str
    label: str
    default_base_url: str | None = None
    requires_api_key: bool
    suggested_models: list[str] = Field(default_factory=list)
    docs_url: str | None = None


class LLMConnectionResponse(BaseModel):
    """Schema for GET/PUT /api/auth/me/llm-connection.

    Never carries the API key itself — only `api_key_hint`, a non-reversible
    display fragment produced by secret_store.mask_secret.
    """

    configured: bool
    provider: str | None = None
    provider_label: str | None = None
    base_url: str | None = None
    model: str | None = None
    has_api_key: bool = False
    api_key_hint: str | None = None
    providers: list[LLMProviderOption] = Field(default_factory=list)


class LLMConnectionUpdate(BaseModel):
    """Schema for PUT /api/auth/me/llm-connection."""

    provider: str = Field(..., max_length=30, description="A provider handle from `providers`")
    base_url: str | None = Field(
        None,
        max_length=500,
        description="Endpoint override; required for providers without a default",
    )
    model: str = Field(..., max_length=200, description="Model name to send to the provider")
    api_key: str | None = Field(
        None,
        max_length=500,
        description=(
            "Omit to keep the stored key; empty string to clear it. Clearing is "
            "only valid for providers that don't require a key — use DELETE to "
            "disconnect otherwise."
        ),
    )


class LLMConnectionTestResponse(BaseModel):
    """Schema for POST /api/auth/me/llm-connection/test."""

    ok: bool
    message: str


class ModelPriceInfo(BaseModel):
    """One provider model with estimated standard token pricing."""

    id: str
    input_price_per_1m: float | None = None
    output_price_per_1m: float | None = None


_MAX_PLAYGROUND_VARIABLES = 50
_MAX_PLAYGROUND_VARIABLE_NAME_LENGTH = 100
_MAX_PLAYGROUND_VARIABLE_VALUE_LENGTH = 10_000


class PlaygroundRunRequest(BaseModel):
    """Schema for POST /api/prompts/{id}/playground/run."""

    model: str = Field(..., max_length=100, description="One of the available Playground models")
    variables: dict[str, str] = Field(
        default_factory=dict, description="Values for the template's {{variable}} placeholders"
    )

    @field_validator("variables")
    @classmethod
    def validate_variables_size(cls, variables: dict[str, str]) -> dict[str, str]:
        """Cap variable count/size — this text is sent to a paid external API."""
        if len(variables) > _MAX_PLAYGROUND_VARIABLES:
            msg = f"Too many variables (max {_MAX_PLAYGROUND_VARIABLES})"
            raise ValueError(msg)
        for name, value in variables.items():
            if (
                len(name) > _MAX_PLAYGROUND_VARIABLE_NAME_LENGTH
                or len(value) > _MAX_PLAYGROUND_VARIABLE_VALUE_LENGTH
            ):
                msg = f"Variable '{name}' exceeds allowed size"
                raise ValueError(msg)
        return variables


class PlaygroundRunResponse(BaseModel):
    """Schema for a successful Playground run."""

    output_text: str
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    model: str


class PlaygroundRunHistoryResponse(BaseModel):
    """Schema for a single row of GET /api/prompts/{id}/playground/runs — the
    Playground history drawer's list, including failed attempts."""

    id: int
    model: str
    input_variables: dict[str, str] | None
    output_text: str
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    status: Literal["success", "error"]
    error_message: str | None
    created_at: datetime

    class Config:
        from_attributes = True


# Parse-text Schemas


class ParseTextRequest(BaseModel):
    """Schema for natural language text parsing request."""

    text: str = Field(
        ...,
        min_length=1,
        max_length=10_000,
        description="User text to convert into structured prompt fields",
    )


class ParseTextResponse(BaseModel):
    """Schema for parsed prompt fields response."""

    fields: list[PromptField]


# Authentication Schemas


class UserCreate(BaseModel):
    """Schema for user registration."""

    username: str = Field(
        ...,
        min_length=3,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_-]+$",
        description="Username (3-50 chars; letters, digits, underscores, hyphens)",
    )
    # min_length=8 for basic strength; max_length=72 matches bcrypt's effective input limit
    password: str = Field(..., min_length=8, max_length=72, description="Password")
    email: EmailStr = Field(
        ..., max_length=254, description="Email address used for password reset"
    )

    @field_validator("username", mode="before")
    @classmethod
    def strip_username(cls, v: str) -> str:
        if isinstance(v, str):
            return v.strip()
        return v


class UserLogin(BaseModel):
    """Schema for user login."""

    username: str = Field(..., description="Username")
    password: str = Field(..., description="Password")


class Token(BaseModel):
    """
    Schema for a session response.

    The access token itself is not here — it is set as an httpOnly cookie, so
    that page scripts (and anything that gets itself onto the page) cannot read
    it. `expires_at` is what the UI needs to warn about an imminent timeout.
    """

    token_type: str = "bearer"
    expires_at: datetime


class TokenData(BaseModel):
    """Schema for token payload data."""

    username: str | None = None


class UserResponse(BaseModel):
    """Schema for user response."""

    id: int
    username: str
    email: str | None = None
    created_at: datetime
    notify_run_failure: bool = False
    notify_weekly_summary: bool = False
    default_library_view: Literal["grid", "list"] | None = None
    default_eval_method: Literal["rule", "judge", "manual"] | None = None
    auto_run_eval_on_update: bool = False
    notify_eval_complete: bool = False
    notify_eval_regression: bool = False

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    """Schema for updating the authenticated user's profile (PATCH /api/auth/me)."""

    email: EmailStr | None = Field(
        None,
        max_length=254,  # RFC 5321 maximum
        description="Email address used for password reset",
    )
    new_username: str | None = Field(
        None,
        min_length=3,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_-]+$",
        description="New username (3-50 chars; letters, digits, underscores, hyphens)",
    )
    # `default_model` was removed here: the model now lives on the user's
    # provider connection (PUT /api/auth/me/llm-connection), so a second,
    # separately-validated model preference had no coherent meaning.
    notify_run_failure: bool | None = Field(None, description="Email when a Playground run errors")
    notify_weekly_summary: bool | None = Field(
        None,
        description=(
            "Opt in to a weekly usage-summary email, sent by a cron-invoked "
            "script (`make send-weekly-summary`). See product/DECISIONS.md."
        ),
    )
    default_library_view: Literal["grid", "list"] | None = Field(
        None, description="Initial view mode when opening the Library"
    )
    default_eval_method: Literal["rule", "judge", "manual"] | None = Field(
        None, description="Preselected scoring method for newly-added eval cases"
    )
    auto_run_eval_on_update: bool | None = Field(
        None,
        description=(
            "Automatically trigger a real eval run after saving an Update in the "
            "Configuration tab, if the prompt has at least one eval case."
        ),
    )
    notify_eval_complete: bool | None = Field(
        None, description="Email when an eval run finishes scoring"
    )
    notify_eval_regression: bool | None = Field(
        None, description="Email when a new eval run scores lower than the previous run"
    )

    @field_validator("new_username", mode="before")
    @classmethod
    def strip_new_username(cls, v: str | None) -> str | None:
        if isinstance(v, str):
            return v.strip()
        return v


class ForgotPasswordRequest(BaseModel):
    """Schema for requesting a password reset email."""

    email: EmailStr = Field(..., max_length=254, description="Email address on the account")


class ResetPasswordRequest(BaseModel):
    """Schema for completing a password reset using the emailed token."""

    token: str = Field(..., min_length=1, description="Reset token from the email link")
    new_password: str = Field(
        ...,
        min_length=8,
        max_length=72,
        description="New password (min 8 chars, max 72 to match bcrypt limit)",
    )


class DeleteAccountRequest(BaseModel):
    """Schema for DELETE /api/auth/me.

    Deletion is irreversible and removes every row the user owns, so it asks for
    the password rather than accepting the session alone — an unattended or
    stolen browser session should not be enough to destroy an account.
    """

    current_password: str = Field(
        ..., min_length=1, max_length=72, description="Current password, for verification"
    )


class ChangePasswordRequest(BaseModel):
    """Schema for authenticated in-app password change (POST /api/auth/change-password)."""

    current_password: str = Field(
        ..., min_length=1, max_length=72, description="Current password, for verification"
    )
    new_password: str = Field(
        ...,
        min_length=8,
        max_length=72,
        description="New password (min 8 chars, max 72 to match bcrypt limit)",
    )


# Evaluate Schemas

_MAX_EVAL_VARIABLES = 50
_MAX_EVAL_VARIABLE_NAME_LENGTH = 100
_MAX_EVAL_VARIABLE_VALUE_LENGTH = 10_000
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


# Refine Schemas


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
