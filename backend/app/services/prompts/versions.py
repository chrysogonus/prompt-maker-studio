"""Versions operations shared by REST and MCP. Mutations own their commit."""

from sqlalchemy.orm import Session

from app.models.prompt_version import PromptVersion
from app.schemas.prompts import PromptVersionResponse
from app.services.errors import OperationError
from app.services.optimistic_concurrency import next_write_stamp
from app.services.prompt_version_service import PromptVersionService
from app.services.prompts.ownership import get_owned_prompt as _get_owned_prompt


def get_prompt_versions(prompt_id: int, db: Session, user_id: int):
    """Retrieve the version history of an owned prompt, newest first."""
    prompt = _get_owned_prompt(prompt_id, user_id, db)
    versions = (
        db.query(PromptVersion)
        .filter(PromptVersion.prompt_id == prompt.id)
        .order_by(PromptVersion.version_number.desc())
        .all()
    )
    return [
        PromptVersionResponse(
            id=v.id,
            version_number=v.version_number,
            note=v.note,
            legacy_note=v.legacy_note,
            variable_metadata=v.variable_metadata,
            author=v.author.username if v.author else None,
            fields=v.fields,
            generated_prompt=v.generated_prompt,
            created_at=v.created_at,
        )
        for v in versions
    ]


def restore_prompt_version(prompt_id: int, version_id: int, db: Session, user_id: int):
    """Restore an owned prompt to a prior version's content."""
    prompt = _get_owned_prompt(prompt_id, user_id, db)
    version = (
        db.query(PromptVersion)
        .filter(PromptVersion.id == version_id, PromptVersion.prompt_id == prompt.id)
        .first()
    )
    if not version:
        raise OperationError(status_code=404, detail="Version not found")

    PromptVersionService.restore(db, prompt, version, user_id)
    prompt.updated_at = next_write_stamp(prompt.updated_at or prompt.created_at)

    db.commit()
    db.refresh(prompt)
    return prompt
