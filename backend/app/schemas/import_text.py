"""Import Text request and response contracts."""

from pydantic import BaseModel, Field

from app.schemas.prompts import PromptField


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
