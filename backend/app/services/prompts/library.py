"""Library operations shared by REST and MCP. Mutations own their commit."""

from copy import deepcopy
from http import HTTPStatus

from sqlalchemy.orm import Session

from app.metrics import (
    prompts_saved_total,
)
from app.models.eval_case import EvalCase
from app.models.prompt import Prompt
from app.schemas.prompts import PromptCreateRequest, PromptUpdateRequest, VariableMetadataItem
from app.services.errors import OperationError
from app.services.optimistic_concurrency import is_stale, next_write_stamp
from app.services.prompt_id_service import PromptIdService
from app.services.prompt_sections import render_sections
from app.services.prompt_version_service import PromptVersionService
from app.services.prompts.ownership import get_owned_prompt as _get_owned_prompt


def create_prompt(body: PromptCreateRequest, db: Session, user_id: int):
    """Save a new prompt to the calling user's library."""
    fields = [{"name": field.name, "content": field.content} for field in body.fields]
    prompt = Prompt(
        id=PromptIdService.next_id(db),
        user_id=user_id,
        fields=fields,
        generated_prompt=render_sections(fields),
        name=body.name,
        folder=(body.folder or "").strip() or None,
        variable_metadata=(
            {k: v.model_dump() for k, v in body.variable_metadata.items()}
            if body.variable_metadata
            else None
        ),
    )
    db.add(prompt)
    db.commit()
    db.refresh(prompt)

    prompts_saved_total.inc()

    return prompt


def get_saved_prompts(folder: str | None, favorite_only: bool, db: Session, user_id: int):
    """Retrieve every prompt in the calling user's library."""
    query = db.query(Prompt).filter(Prompt.user_id == user_id, Prompt.name.isnot(None))

    if folder:
        query = query.filter(Prompt.folder == folder)
    if favorite_only:
        query = query.filter(Prompt.is_favorite.is_(True))

    return query.order_by(Prompt.created_at.desc()).all()


def get_prompt_by_id(prompt_id: int, db: Session, user_id: int):
    """Retrieve a specific prompt by ID, scoped to the calling user."""
    return _get_owned_prompt(prompt_id, user_id, db)


def update_prompt(prompt_id: int, body: PromptUpdateRequest, db: Session, user_id: int):
    """Update an owned prompt's name, sections, or organisation."""
    prompt = _get_owned_prompt(prompt_id, user_id, db)

    # Optimistic concurrency check
    if body.last_updated_at is not None:
        db_time = prompt.updated_at or prompt.created_at
        if is_stale(db_time, body.last_updated_at):
            raise OperationError(
                status_code=HTTPStatus.CONFLICT,
                detail="This prompt has been modified by another session. Please reload to merge or overwrite.",
            )

    next_fields = (
        [{"name": field.name, "content": field.content} for field in body.fields]
        if body.fields is not None
        else None
    )
    next_metadata = (
        {k: v.model_dump() for k, v in body.variable_metadata.items()}
        if body.variable_metadata is not None
        else None
    )
    if (next_fields is not None and next_fields != prompt.fields) or (
        next_metadata is not None
        and next_metadata
        != {
            name: VariableMetadataItem.model_validate(item).model_dump()
            for name, item in (prompt.variable_metadata or {}).items()
        }
    ):
        PromptVersionService.snapshot(db, prompt, user_id, note=body.note)

    if body.name is not None:
        prompt.name = body.name
    if next_fields is not None:
        prompt.fields = next_fields
        prompt.generated_prompt = render_sections(next_fields)
    if body.folder is not None:
        prompt.folder = body.folder
    if body.is_favorite is not None:
        prompt.is_favorite = body.is_favorite
    if next_metadata is not None:
        prompt.variable_metadata = next_metadata

    prompt.updated_at = next_write_stamp(prompt.updated_at or prompt.created_at)

    db.commit()
    db.refresh(prompt)
    return prompt


def delete_prompt(prompt_id: int, db: Session, user_id: int):
    """Delete an owned prompt permanently."""
    prompt = _get_owned_prompt(prompt_id, user_id, db)
    db.delete(prompt)
    db.commit()


def duplicate_prompt(prompt_id: int, db: Session, user_id: int):
    """Duplicate an existing prompt.  Only the owner may duplicate a prompt.
    The duplicate receives a collision-free copy name and preserves all
    authoring configuration and eval cases. Run and version history
    intentionally remain attached only to the original."""
    original = _get_owned_prompt(prompt_id, user_id, db)
    # 100 matches the name length cap enforced elsewhere (PromptRequest/PromptUpdateRequest).
    base_name = f"{original.name or 'Untitled Prompt'} Duplicate"[:100]
    existing_names = {
        row[0]
        for row in db.query(Prompt.name)
        .filter(Prompt.user_id == user_id, Prompt.name.isnot(None))
        .all()
    }
    duplicate_name = base_name
    suffix = 1
    while duplicate_name in existing_names:
        suffix_text = f" {suffix}"
        duplicate_name = f"{base_name[: 100 - len(suffix_text)]}{suffix_text}"
        suffix += 1

    duplicated = Prompt(
        id=PromptIdService.next_id(db),
        user_id=user_id,
        fields=deepcopy(original.fields),
        generated_prompt=original.generated_prompt,
        name=duplicate_name,
        folder=original.folder,
        is_favorite=False,
        tags=deepcopy(original.tags),
        variable_metadata=deepcopy(original.variable_metadata),
    )

    db.add(duplicated)
    db.flush()

    original_cases = (
        db.query(EvalCase)
        .filter(EvalCase.prompt_id == original.id)
        .order_by(EvalCase.position)
        .all()
    )
    db.add_all(
        [
            EvalCase(
                prompt_id=duplicated.id,
                method=case.method,
                name=case.name,
                criteria=case.criteria,
                variables=deepcopy(case.variables),
                intentionally_empty=case.intentionally_empty,
                position=case.position,
            )
            for case in original_cases
        ]
    )
    db.commit()
    db.refresh(duplicated)

    prompts_saved_total.inc()
    return duplicated
