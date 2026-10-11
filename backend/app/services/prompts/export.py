"""Export operations shared by REST and MCP. Mutations own their commit."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session, joinedload

from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion
from app.schemas.prompts import DataExportResponse, ExportedPrompt, ExportedPromptVersion


def export_prompts(db: Session, user_id: int):
    """Export all of the calling user's prompts — fields, folder, tags,
    generated text, and full version history — as JSON, for the Settings
    "Export all prompts" action."""
    prompts = (
        db.query(Prompt).filter(Prompt.user_id == user_id).order_by(Prompt.created_at.asc()).all()
    )

    # Batch-load every version (with its author) for all prompts in one query
    # instead of one query per prompt — this scaled linearly with a user's
    # saved-prompt count, unlike the aggregate queries in analytics_service.py.
    prompt_ids = [prompt.id for prompt in prompts]
    versions_by_prompt_id: dict[int, list[PromptVersion]] = {pid: [] for pid in prompt_ids}
    if prompt_ids:
        all_versions = (
            db.query(PromptVersion)
            .options(joinedload(PromptVersion.author))
            .filter(PromptVersion.prompt_id.in_(prompt_ids))
            .order_by(PromptVersion.prompt_id.asc(), PromptVersion.version_number.asc())
            .all()
        )
        for version in all_versions:
            versions_by_prompt_id[version.prompt_id].append(version)

    exported = [
        ExportedPrompt(
            id=prompt.id,
            name=prompt.name,
            fields=prompt.fields,
            generated_prompt=prompt.generated_prompt,
            folder=prompt.folder,
            tags=prompt.tags,
            is_favorite=prompt.is_favorite,
            created_at=prompt.created_at,
            updated_at=prompt.updated_at,
            versions=[
                ExportedPromptVersion(
                    version_number=v.version_number,
                    note=v.note,
                    author=v.author.username if v.author else None,
                    fields=v.fields,
                    generated_prompt=v.generated_prompt,
                    created_at=v.created_at,
                )
                for v in versions_by_prompt_id[prompt.id]
            ],
        )
        for prompt in prompts
    ]

    return DataExportResponse(exported_at=datetime.now(UTC), prompts=exported)
