"""Connections request and response contracts."""

from pydantic import BaseModel, Field


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
