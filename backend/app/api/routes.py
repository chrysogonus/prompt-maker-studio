"""
API route handlers for prompt operations.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import call_service, get_llm_connection, llm_http_error
from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.limiter import limiter
from app.metrics import observe_operation
from app.models.user import User
from app.schemas.connections import PromptsConfigResponse
from app.schemas.import_text import ParseTextRequest, ParseTextResponse, PromptConversionResponse
from app.schemas.prompts import (
    DataExportResponse,
    FolderChangeResponse,
    FolderRenameRequest,
    PromptCreateRequest,
    PromptHistoryResponse,
    PromptUpdateRequest,
    PromptVersionResponse,
    TryPromptRequest,
    TryPromptResponse,
)
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.llm_client import (
    LLMResponseFormatError,
    active_provider_and_model,
    available_models_for,
)
from app.services.playground_service import try_once
from app.services.prompt_parser import PromptParserService as TextParserService
from app.services.prompts import export, folders, library, versions
from app.services.spend_ledger import record_billed_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


@router.post("/try", response_model=TryPromptResponse)
@limiter.limit("10/minute")
def try_prompt(
    request: Request,
    body: TryPromptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Try the filled editor text once without creating or modifying a prompt."""
    return call_service(try_once, body.text, get_llm_connection(current_user), db, current_user.id)


@router.post("/parse-text", response_model=ParseTextResponse | PromptConversionResponse)
@limiter.limit("20/minute")
@observe_operation("ai_import")
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

    try:
        if body.extract_variables:
            raw, usage = TextParserService.convert(body.text, connection)
        else:
            fields, usage = TextParserService.parse(body.text, connection)
    except Exception as exc:
        raise llm_http_error(exc, connection, "parse-text") from exc

    record_billed_call(db, current_user.id, "parse", usage)
    db.commit()

    if body.extract_variables:
        try:
            return TextParserService.validate_conversion(body.text, raw)
        except Exception as exc:
            # Validation errors can include the user's source text; keep it out of logs.
            failure = LLMResponseFormatError(
                f"{connection.provider_label} returned an invalid template or extracted inputs. "
                "Try again or choose a more capable model in Settings → API access."
            )
            raise llm_http_error(failure, connection, "parse-text conversion validation") from exc
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
    return call_service(library.create_prompt, body=body, db=db, user_id=current_user.id)


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
    return call_service(
        library.get_saved_prompts,
        folder=folder,
        favorite_only=favorite_only,
        db=db,
        user_id=current_user.id,
    )


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
    return call_service(folders.get_prompt_folders, db=db, user_id=current_user.id)


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
    return call_service(folders.rename_folder, body=body, name=name, db=db, user_id=current_user.id)


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
    return call_service(folders.remove_folder, name=name, db=db, user_id=current_user.id)


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
    return call_service(export.export_prompts, db=db, user_id=current_user.id)


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
    return call_service(
        library.get_prompt_by_id, prompt_id=prompt_id, db=db, user_id=current_user.id
    )


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
    return call_service(
        library.update_prompt, prompt_id=prompt_id, body=body, db=db, user_id=current_user.id
    )


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
    return call_service(
        versions.get_prompt_versions, prompt_id=prompt_id, db=db, user_id=current_user.id
    )


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
    return call_service(
        versions.restore_prompt_version,
        prompt_id=prompt_id,
        version_id=version_id,
        db=db,
        user_id=current_user.id,
    )


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
    return call_service(library.delete_prompt, prompt_id=prompt_id, db=db, user_id=current_user.id)


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
    return call_service(
        library.duplicate_prompt, prompt_id=prompt_id, db=db, user_id=current_user.id
    )
