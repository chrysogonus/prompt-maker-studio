"""
Pydantic schemas for request/response validation.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.services.prompt_sections import section_tag


class VariableMetadataItem(BaseModel):
    """Type/description for a single `{{variable}}` detected in a prompt template."""

    type: Literal["text", "number", "boolean", "list"] = "text"
    description: str | None = Field(None, max_length=500)


class PromptField(BaseModel):
    """Schema for a single prompt field (a section of the prompt)."""

    # Names are what the user reads, so spaces are allowed; the rendered tag
    # turns them into underscores (`Output format` -> `<OUTPUT_FORMAT>`). The
    # pattern keeps that tag a valid XML name: it starts with a letter or
    # underscore, followed by letters, digits, underscores, hyphens or spaces.
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z_][A-Za-z0-9_ -]*$",
        description=(
            "Section name, e.g. 'Role' or 'Output format'. Rendered as an XML tag with "
            "spaces turned into underscores and letters upper-cased ('<OUTPUT_FORMAT>')."
        ),
    )
    content: str = Field(..., max_length=10_000, description="Field content")

    @field_validator("name", mode="before")
    @classmethod
    def collapse_whitespace(cls, name: object) -> object:
        """Trim and collapse runs of whitespace, so `' Output   format '` is `'Output format'`."""
        return " ".join(name.split()) if isinstance(name, str) else name


def _require_unique_section_tags(fields: list[PromptField] | None) -> list[PromptField] | None:
    """Two sections that render to the same tag (`Role`/`role`, `a b`/`a_b`) would
    produce two identical blocks in one prompt."""
    if fields is None:
        return fields
    tags = [section_tag(field.name) for field in fields]
    if len(tags) != len(set(tags)):
        msg = "Field names must be unique"
        raise ValueError(msg)
    return fields


class PromptCreateRequest(BaseModel):
    """Schema for saving a new prompt to the library (POST /api/prompts).

    The prompt's text is rendered from `fields` on the server; it is never sent.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=100, description="Name in the library")
    fields: list[PromptField] = Field(
        ..., min_length=1, max_length=100, description="The prompt's sections, in order"
    )
    folder: str | None = Field(None, max_length=255, description="Folder; empty means unfiled")
    variable_metadata: dict[str, VariableMetadataItem] | None = Field(
        None, description="Description per template variable, keyed by name"
    )

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, name: object) -> object:
        return name.strip() if isinstance(name, str) else name

    @field_validator("fields")
    @classmethod
    def validate_field_names(cls, fields: list[PromptField]) -> list[PromptField]:
        return _require_unique_section_tags(fields)


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
    variable_metadata: dict[str, VariableMetadataItem] | None = None

    class Config:
        from_attributes = True


class PromptUpdateRequest(BaseModel):
    """Schema for updating an existing prompt (PATCH).

    All fields are optional — only provided fields are updated. As with
    `name`/`fields`, `None` means "not provided"; to clear `folder` or
    `variable_metadata` explicitly, PATCH with `""` / `{}`.

    The prompt's text is rendered from `fields`, so `generated_prompt` is not
    accepted: unknown keys are rejected rather than silently ignored.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, max_length=100, description="New name for the saved prompt")
    fields: list[PromptField] | None = Field(
        None, max_length=100, description="Updated prompt fields"
    )
    folder: str | None = Field(None, max_length=255, description="Organizational folder label")
    is_favorite: bool | None = Field(None, description="Whether the prompt is starred")
    variable_metadata: dict[str, VariableMetadataItem] | None = Field(
        None, description="Type/description per detected template variable, keyed by name"
    )
    note: str | None = Field(
        None, max_length=255, description="Optional version-history note for this edit"
    )
    last_updated_at: datetime | None = Field(
        None, description="Timestamp of the last known update to detect concurrent edit conflicts"
    )

    @field_validator("fields")
    @classmethod
    def validate_field_names(cls, fields: list[PromptField] | None) -> list[PromptField] | None:
        return _require_unique_section_tags(fields)


class FolderRenameRequest(BaseModel):
    """Schema for renaming a folder (PATCH /api/prompts/folders)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=255, description="New folder name")

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, name: object) -> object:
        return name.strip() if isinstance(name, str) else name


class FolderChangeResponse(BaseModel):
    """Result of renaming or removing a folder."""

    name: str
    prompt_count: int = Field(..., description="How many prompts moved")


class PromptVersionResponse(BaseModel):
    """Schema for a single prompt version snapshot."""

    id: int
    version_number: int
    note: str | None
    author: str | None
    fields: list[PromptField]
    generated_prompt: str
    created_at: datetime


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


class LLMServerDefault(BaseModel):
    """The operator's deployment-wide connection, as shown to users. Carries
    no base URL or key — only what a user needs to recognise it."""

    provider_label: str
    model: str


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
    # Used whenever `configured` is false; None when the operator set none.
    server_default: LLMServerDefault | None = None


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
    default_library_view: Literal["grid", "list"] | None = None
    default_eval_method: Literal["rule", "judge", "manual"] | None = None
    auto_run_eval_on_update: bool = False

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
    default_library_view: Literal["grid", "list"] | None = Field(
        None, description="Initial view mode when opening the Library"
    )
    default_eval_method: Literal["rule", "judge", "manual"] | None = Field(
        None, description="Preselected scoring method for newly-added eval cases"
    )
    auto_run_eval_on_update: bool | None = Field(
        None,
        description=(
            "Kept for when Evaluate returns. Nothing starts an evaluation on its own "
            "while Evaluate is deferred."
        ),
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
