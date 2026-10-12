"""Import Text request and response contracts."""

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.prompts import PromptField


class ParseTextRequest(BaseModel):
    """Schema for natural language text parsing request."""

    text: str = Field(
        ...,
        min_length=1,
        max_length=10_000,
        description="User text to convert into structured prompt fields",
    )

    extract_variables: bool = False


class ParseTextResponse(BaseModel):
    """Schema for parsed prompt fields response."""

    fields: list[PromptField]


class ExtractedVariable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., max_length=100, pattern=r"^[A-Za-z_][A-Za-z0-9_-]*$")
    value: str = Field(..., max_length=10_000)
    description: str = Field(..., max_length=500)
    source_text: str | None = Field(..., min_length=1, max_length=10_000)


class ConvertedField(PromptField):
    model_config = ConfigDict(extra="forbid")


class PromptConversionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fields: list[ConvertedField] = Field(..., min_length=1, max_length=100)
    variables: list[ExtractedVariable] = Field(..., max_length=50)
