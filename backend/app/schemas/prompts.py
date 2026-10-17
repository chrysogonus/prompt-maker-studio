"""Prompts request and response contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.prompt_sections import section_tag


class VariableMetadataItem(BaseModel):
    """Type/description for a single `{{variable}}` detected in a prompt template."""

    type: Literal["text", "number", "boolean", "list"] = "text"
    description: str | None = Field(None, max_length=500)
    required: bool = False
    example: str | None = Field(None, max_length=10_000)


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
    content_updated_at: datetime | None = None
    current_note: str | None = None
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
    legacy_note: str | None = None
    variable_metadata: dict[str, VariableMetadataItem] | None = None
    author: str | None
    fields: list[PromptField]
    generated_prompt: str
    created_at: datetime


class ExportedPromptVersion(BaseModel):
    """Schema for a version snapshot within a data export."""

    version_number: int
    note: str | None
    legacy_note: str | None = None
    variable_metadata: dict[str, VariableMetadataItem] | None = None
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
    content_updated_at: datetime | None = None
    current_note: str | None = None
    variable_metadata: dict[str, VariableMetadataItem] | None = None
    versions: list[ExportedPromptVersion]


class DataExportResponse(BaseModel):
    """Schema for GET /api/prompts/export — the full downloadable data dump."""

    exported_at: datetime
    prompts: list[ExportedPrompt]


class TryPromptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(..., min_length=1, max_length=100_000)

    @field_validator("text")
    @classmethod
    def require_content(cls, value: str) -> str:
        if not value.strip():
            message = "Enter some prompt text before running"
            raise ValueError(message)
        return value


class TryPromptResponse(BaseModel):
    output_text: str
    provider: str
    model: str
