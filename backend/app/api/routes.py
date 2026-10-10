"""
API route handlers for prompt operations.
"""

from copy import deepcopy
from datetime import UTC, datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_llm_connection, llm_http_error
from app.api.deps import get_owned_prompt as _get_owned_prompt
from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.limiter import limiter
from app.metrics import (
    ai_import_failures_total,
    ai_imports_total,
    prompts_saved_total,
)
from app.models.eval_case import EvalCase
from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion
from app.models.schemas import (
    DataExportResponse,
    ExportedPrompt,
    ExportedPromptVersion,
    FolderChangeResponse,
    FolderRenameRequest,
    ParseTextRequest,
    ParseTextResponse,
    PromptCreateRequest,
    PromptHistoryResponse,
    PromptsConfigResponse,
    PromptUpdateRequest,
    PromptVersionResponse,
)
from app.models.user import User
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.llm_client import active_provider_and_model, available_models_for
from app.services.optimistic_concurrency import is_stale, next_write_stamp
from app.services.prompt_id_service import PromptIdService
from app.services.prompt_parser import PromptParserService as TextParserService
from app.services.prompt_sections import render_sections
from app.services.prompt_version_service import PromptVersionService
from app.services.spend_ledger import record_billed_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


@router.post("/parse-text", response_model=ParseTextResponse)
@limiter.limit("20/minute")
def parse_prompt_text(
    request: Request,
    body: ParseTextRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Convert a natural language description into structured prompt fields using an LLM.

    Args:
        request: Starlette request (used by rate limiter)
        body: Contains the free-form text to parse
        db: Database session
        current_user: Current authenticated user

    Returns:
        Structured list of prompt fields extracted from the text

    Raises:
        HTTPException: If no provider is connected, a spend ceiling has been
            reached, or the LLM call fails
    """
    connection = get_llm_connection(current_user)

    try:
        BudgetService.check(db, current_user.id)
    except BudgetExceededError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc

    ai_imports_total.inc()
    try:
        fields, usage = TextParserService.parse(body.text, connection)
    except Exception as exc:
        ai_import_failures_total.inc()
        raise llm_http_error(exc, connection, "parse-text") from exc

    record_billed_call(db, current_user.id, "parse", usage)
    db.commit()

    return ParseTextResponse(fields=fields)


@router.post("", response_model=PromptHistoryResponse, status_code=status.HTTP_201_CREATED)
def create_prompt(
    body: PromptCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Save a new prompt to the calling user's library.

    The prompt's text is rendered from its sections here, never taken from the
    client, so the two cannot disagree.

    Args:
        body: Name, sections, and optional folder and variable descriptions
        db: Database session
        current_user: Current authenticated user; the prompt is stored under their account

    Returns:
        The saved prompt
    """
    fields = [{"name": field.name, "content": field.content} for field in body.fields]
    prompt = Prompt(
        id=PromptIdService.next_id(db),
        user_id=current_user.id,
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


@router.get("/saved", response_model=list[PromptHistoryResponse])
def get_saved_prompts(
    folder: str | None = Query(default=None, max_length=255),
    favorite_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Retrieve every prompt in the calling user's library.

    Every prompt has a name; migration 024 named the unnamed ones the retired
    History tab used to list, and new prompts cannot be saved without one.

    Args:
        folder: Optional exact folder label to filter by
        favorite_only: If true, only return favorited prompts
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of named prompts ordered newest first
    """
    query = db.query(Prompt).filter(Prompt.user_id == current_user.id, Prompt.name.isnot(None))

    if folder:
        query = query.filter(Prompt.folder == folder)
    if favorite_only:
        query = query.filter(Prompt.is_favorite.is_(True))

    return query.order_by(Prompt.created_at.desc()).all()


@router.get("/folders", response_model=list[str])
def get_prompt_folders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Distinct folder labels used across the calling user's prompts.

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        Sorted list of distinct folder labels
    """
    rows = (
        db.query(Prompt.folder)
        .filter(Prompt.user_id == current_user.id, Prompt.folder.isnot(None))
        .distinct()
        .all()
    )
    return sorted({row[0] for row in rows if row[0]})


@router.patch("/folders", response_model=FolderChangeResponse)
def rename_folder(
    body: FolderRenameRequest,
    name: str = Query(..., min_length=1, max_length=255, description="Folder to rename"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Rename a folder by moving every prompt in it to the new name.

    Folders are labels on prompts, so renaming onto a name already in use
    merges the two. Prompts keep their `updated_at`: filing is not an edit, and
    bumping it would reorder the library and invalidate open editors.

    Args:
        body: The new folder name
        name: Current folder name, matched exactly
        db: Database session
        current_user: Current authenticated user; only their prompts move

    Returns:
        The folder's new name and how many prompts moved

    Raises:
        HTTPException: 404 if the caller has no prompts in that folder
    """
    moved = (
        db.query(Prompt)
        .filter(Prompt.user_id == current_user.id, Prompt.folder == name)
        .update({Prompt.folder: body.name}, synchronize_session=False)
    )
    if not moved:
        raise HTTPException(status_code=404, detail="Folder not found")
    db.commit()
    return FolderChangeResponse(name=body.name, prompt_count=moved)


@router.delete("/folders", response_model=FolderChangeResponse)
def remove_folder(
    name: str = Query(..., min_length=1, max_length=255, description="Folder to remove"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Remove a folder. Its prompts move to Unfiled; none are deleted.

    Args:
        name: Folder name, matched exactly
        db: Database session
        current_user: Current authenticated user; only their prompts move

    Returns:
        The removed folder's name and how many prompts became unfiled

    Raises:
        HTTPException: 404 if the caller has no prompts in that folder
    """
    moved = (
        db.query(Prompt)
        .filter(Prompt.user_id == current_user.id, Prompt.folder == name)
        .update({Prompt.folder: None}, synchronize_session=False)
    )
    if not moved:
        raise HTTPException(status_code=404, detail="Folder not found")
    db.commit()
    return FolderChangeResponse(name=name, prompt_count=moved)


@router.get("/export", response_model=DataExportResponse)
@limiter.limit("10/minute")
def export_prompts(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Export all of the calling user's prompts — fields, folder, tags,
    generated text, and full version history — as JSON, for the Settings
    "Export all prompts" action.

    Args:
        request: Starlette request (used by rate limiter)
        db: Database session
        current_user: Current authenticated user

    Returns:
        A timestamped JSON dump of every owned prompt and its version history
    """
    prompts = (
        db.query(Prompt)
        .filter(Prompt.user_id == current_user.id)
        .order_by(Prompt.created_at.asc())
        .all()
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


@router.get("/config", response_model=PromptsConfigResponse)
def get_prompts_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Report the calling user's AI capability state, so the frontend can
    proactively disable AI features and point at Settings instead of letting
    them fail at call time.

    Authenticated — unlike the operator-wide env check this replaced, "is AI
    available" is now a per-user question about that user's own bring-your-own
    provider connection. No credential is included: only the provider handle,
    label, and model.

    Returns:
        Whether the caller has a usable connection, which provider/model it
        points at, the model choices to offer (empty when unconfigured, so the
        frontend never advertises a model it can't run), and whether the
        operator's global monthly spend ceiling is exhausted (BudgetService).
    """
    provider, model = active_provider_and_model(current_user) or (None, None)
    budget_status = BudgetService.global_status(db)
    return PromptsConfigResponse(
        provider_connected=provider is not None,
        provider=provider.handle if provider else None,
        provider_label=provider.label if provider else None,
        model=model,
        available_models=available_models_for(current_user),
        **budget_status,
    )


@router.get("/{prompt_id}", response_model=PromptHistoryResponse)
def get_prompt_by_id(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Retrieve a specific prompt by ID, scoped to the calling user.

    Args:
        prompt_id: Unique identifier of the prompt
        db: Database session
        current_user: Current authenticated user

    Returns:
        Prompt details

    Raises:
        HTTPException: If prompt not found or not owned by the current user
    """
    return _get_owned_prompt(prompt_id, current_user.id, db)


@router.patch("/{prompt_id}", response_model=PromptHistoryResponse)
def update_prompt(
    prompt_id: int,
    body: PromptUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update an owned prompt's name, sections, or organisation.

    Only the fields included in the request body are updated; omitted
    fields retain their current values. New sections re-render the prompt's
    text, and snapshot the previous state as a version when they change it.

    Args:
        prompt_id: Unique identifier of the prompt to update
        body: Partial update payload
        db: Database session
        current_user: Current authenticated user

    Returns:
        Updated prompt

    Raises:
        HTTPException: If prompt not found or not owned by the current user
    """
    prompt = _get_owned_prompt(prompt_id, current_user.id, db)

    # Optimistic concurrency check
    if body.last_updated_at is not None:
        db_time = prompt.updated_at or prompt.created_at
        if is_stale(db_time, body.last_updated_at):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This prompt has been modified by another session. Please reload to merge or overwrite.",
            )

    next_fields = (
        [{"name": field.name, "content": field.content} for field in body.fields]
        if body.fields is not None
        else None
    )
    if next_fields is not None and next_fields != prompt.fields:
        PromptVersionService.snapshot(db, prompt, current_user.id, note=body.note)

    if body.name is not None:
        prompt.name = body.name
    if next_fields is not None:
        prompt.fields = next_fields
        prompt.generated_prompt = render_sections(next_fields)
    if body.folder is not None:
        prompt.folder = body.folder
    if body.is_favorite is not None:
        prompt.is_favorite = body.is_favorite
    if body.variable_metadata is not None:
        prompt.variable_metadata = {k: v.model_dump() for k, v in body.variable_metadata.items()}

    prompt.updated_at = next_write_stamp(prompt.updated_at or prompt.created_at)

    db.commit()
    db.refresh(prompt)
    return prompt


@router.get("/{prompt_id}/versions", response_model=list[PromptVersionResponse])
def get_prompt_versions(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Retrieve the version history of an owned prompt, newest first.

    The live prompt row (returned by GET /{prompt_id}) is always the current
    state; these are prior states captured before each edit.

    Args:
        prompt_id: Unique identifier of the prompt
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of historical version snapshots

    Raises:
        HTTPException: If prompt not found or not owned by the current user
    """
    prompt = _get_owned_prompt(prompt_id, current_user.id, db)
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
            author=v.author.username if v.author else None,
            fields=v.fields,
            generated_prompt=v.generated_prompt,
            created_at=v.created_at,
        )
        for v in versions
    ]


@router.post("/{prompt_id}/versions/{version_id}/restore", response_model=PromptHistoryResponse)
def restore_prompt_version(
    prompt_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Restore an owned prompt to a prior version's content.

    Versions recorded before sections became the source of the text may not
    match their own sections; those are restored from their text, the way
    migration 023 recovered live prompts.

    The state being replaced is itself snapshotted first, so restoring never
    loses data — it can always be undone by restoring the newly-created
    "Before restore" version.

    Args:
        prompt_id: Unique identifier of the prompt to restore
        version_id: Unique identifier of the version to restore to
        db: Database session
        current_user: Current authenticated user

    Returns:
        The prompt with its fields/generated_prompt restored

    Raises:
        HTTPException: If the prompt or version is not found/not owned
    """
    prompt = _get_owned_prompt(prompt_id, current_user.id, db)
    version = (
        db.query(PromptVersion)
        .filter(PromptVersion.id == version_id, PromptVersion.prompt_id == prompt.id)
        .first()
    )
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    PromptVersionService.restore(db, prompt, version, current_user.id)
    prompt.updated_at = next_write_stamp(prompt.updated_at or prompt.created_at)

    db.commit()
    db.refresh(prompt)
    return prompt


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Delete an owned prompt permanently.

    Cascades to everything hanging off the prompt: versions, eval cases, eval
    runs and their results, and Playground runs. Billed calls are keyed to the
    user rather than the prompt and are deliberately kept — deleting a prompt
    is not a request to rewrite the spend ledger.

    Args:
        prompt_id: Unique identifier of the prompt to delete
        db: Database session
        current_user: Current authenticated user

    Raises:
        HTTPException: If prompt not found or not owned by the current user
    """
    prompt = _get_owned_prompt(prompt_id, current_user.id, db)
    db.delete(prompt)
    db.commit()


@router.post("/{prompt_id}/duplicate", response_model=PromptHistoryResponse)
def duplicate_prompt(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Duplicate an existing prompt.  Only the owner may duplicate a prompt.
    The duplicate receives a collision-free copy name and preserves all
    authoring configuration and eval cases. Run and version history
    intentionally remain attached only to the original.

    Args:
        prompt_id: Unique identifier of the prompt to duplicate
        db: Database session
        current_user: Current authenticated user

    Returns:
        New duplicated prompt with metadata

    Raises:
        HTTPException: If prompt not found or not owned by the current user
    """
    original = _get_owned_prompt(prompt_id, current_user.id, db)
    # 100 matches the name length cap enforced elsewhere (PromptRequest/PromptUpdateRequest).
    base_name = f"{original.name or 'Untitled Prompt'} Duplicate"[:100]
    existing_names = {
        row[0]
        for row in db.query(Prompt.name)
        .filter(Prompt.user_id == current_user.id, Prompt.name.isnot(None))
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
        user_id=current_user.id,
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
