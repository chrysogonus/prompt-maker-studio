"""
API route handlers for prompt operations.
"""

from copy import deepcopy
from datetime import UTC, datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_llm_connection, llm_http_error
from app.api.deps import get_owned_prompt as _get_owned_prompt
from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.limiter import limiter
from app.metrics import (
    ai_import_failures_total,
    ai_imports_total,
    playground_run_failures_total,
    playground_runs_total,
    prompts_generated_total,
    prompts_saved_total,
)
from app.models.eval_case import EvalCase
from app.models.playground_run import PlaygroundRun
from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion
from app.models.schemas import (
    DataExportResponse,
    ExportedPrompt,
    ExportedPromptVersion,
    ParseTextRequest,
    ParseTextResponse,
    PlaygroundRunHistoryResponse,
    PlaygroundRunRequest,
    PlaygroundRunResponse,
    PromptHistoryResponse,
    PromptRequest,
    PromptResponse,
    PromptsConfigResponse,
    PromptUpdateRequest,
    PromptVersionResponse,
)
from app.models.user import User
from app.services.analytics_service import AnalyticsService
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.email_service import send_playground_run_failure_email
from app.services.llm_client import available_models_for, is_configured
from app.services.llm_providers import get_provider
from app.services.optimistic_concurrency import is_stale, next_write_stamp
from app.services.playground_service import PlaygroundRunError, PlaygroundService
from app.services.prompt_compiler import compile_prompt
from app.services.prompt_generator import PromptGeneratorService
from app.services.prompt_id_service import PromptIdService
from app.services.prompt_parser import PromptParserService as TextParserService
from app.services.prompt_version_service import PromptVersionService
from app.services.spend_ledger import LLMUsage, record_billed_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


def _attach_run_counts(db: Session, user_id: int, prompts: list[Prompt]) -> list[Prompt]:
    """Set `.run_count` (a plain, non-mapped attribute) on each prompt from real
    Playground run data, for `PromptHistoryResponse`'s `from_attributes` pickup."""
    counts = AnalyticsService.run_counts_by_prompt_ids(db, user_id, [p.id for p in prompts])
    for p in prompts:
        p.run_count = counts.get(p.id, 0)
    return prompts


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


@router.post("/generate", response_model=PromptResponse)
@limiter.limit("30/minute")
def generate_prompt(
    request: Request,
    body: PromptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate a new prompt based on user inputs and save to database.

    Args:
        request: Starlette request (used by rate limiter)
        body: Prompt generation parameters (fields and optional name)
        db: Database session
        current_user: Current authenticated user; the prompt is stored under their account

    Returns:
        Generated prompt with metadata
    """
    generated_text = PromptGeneratorService.generate(fields=body.fields)

    fields_data = [{"name": field.name, "content": field.content} for field in body.fields]

    prompt = Prompt(
        id=PromptIdService.next_id(db),
        user_id=current_user.id,
        fields=fields_data,
        generated_prompt=generated_text,
        name=body.name,
    )

    db.add(prompt)
    db.commit()
    db.refresh(prompt)

    prompts_generated_total.inc()
    if prompt.name is not None:
        prompts_saved_total.inc()

    return prompt


@router.get("/saved", response_model=list[PromptHistoryResponse])
def get_saved_prompts(
    tag: str | None = Query(default=None, max_length=50),
    folder: str | None = Query(default=None, max_length=255),
    favorite_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Retrieve all named (saved) prompts belonging to the calling user.

    A prompt is considered "saved" when it has a non-null name.  Unnamed
    prompts appear only in the history view.

    Args:
        tag: Optional tag label to filter by (matched in Python since `tags`
            is a JSON column and this app's scale doesn't warrant a
            database-level JSON query)
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

    prompts = query.order_by(Prompt.created_at.desc()).all()

    if tag:
        prompts = [p for p in prompts if p.tags and tag in p.tags]

    return _attach_run_counts(db, current_user.id, prompts)


@router.get("/tags", response_model=list[str])
def get_prompt_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Distinct tag labels used across the calling user's prompts, for the
    Library's tag filter row.

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        Sorted list of distinct tag labels
    """
    rows = (
        db.query(Prompt.tags)
        .filter(Prompt.user_id == current_user.id, Prompt.tags.isnot(None))
        .all()
    )
    tags: set[str] = set()
    for (prompt_tags,) in rows:
        if prompt_tags:
            tags.update(prompt_tags)
    return sorted(tags)


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
    connected = is_configured(current_user)
    provider = get_provider(current_user.llm_provider) if connected else None
    budget_status = BudgetService.global_status(db)
    return PromptsConfigResponse(
        provider_connected=connected,
        provider=provider.handle if provider else None,
        provider_label=provider.label if provider else None,
        model=current_user.llm_model if connected else None,
        available_models=available_models_for(current_user),
        **budget_status,
    )


@router.get("/history", response_model=list[PromptHistoryResponse])
def get_prompt_history(
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Retrieve the calling user's recent prompt generation history.

    Args:
        limit: Maximum number of records to return
        offset: Number of records to skip, for paging past the first page
        search: Optional case-insensitive substring match against visible
            history fields (display name or created date)
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of historical prompts belonging to the current user
    """
    query = db.query(Prompt).filter(Prompt.user_id == current_user.id)

    if search and search.strip():
        normalized_search = search.strip()
        like_pattern = f"%{normalized_search}%"
        visible_matches = [
            Prompt.name.ilike(like_pattern),
            cast(Prompt.fields, String).ilike(like_pattern),
            cast(Prompt.created_at, String).ilike(like_pattern),
        ]
        if normalized_search.lower() in "unnamed generation":
            visible_matches.append(Prompt.name.is_(None))
        query = query.filter(or_(*visible_matches))

    prompts = query.order_by(Prompt.created_at.desc()).offset(offset).limit(limit).all()
    return _attach_run_counts(db, current_user.id, prompts)


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
    prompt = _get_owned_prompt(prompt_id, current_user.id, db)
    _attach_run_counts(db, current_user.id, [prompt])
    return prompt


@router.patch("/{prompt_id}", response_model=PromptHistoryResponse)
def update_prompt(
    prompt_id: int,
    body: PromptUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update name, fields, and/or generated_prompt of an owned prompt.

    Only the fields included in the request body are updated; omitted
    fields retain their current values.

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

    was_unnamed = prompt.name is None
    next_fields = (
        [{"name": field.name, "content": field.content} for field in body.fields]
        if body.fields is not None
        else None
    )
    content_changing = (next_fields is not None and next_fields != prompt.fields) or (
        body.generated_prompt is not None and body.generated_prompt != prompt.generated_prompt
    )
    # Only version already-saved prompts — an unnamed history entry has no
    # prior "saved" state worth preserving.
    if not was_unnamed and content_changing:
        PromptVersionService.snapshot(db, prompt, current_user.id, note=body.note)

    if body.name is not None:
        prompt.name = body.name
    if next_fields is not None:
        prompt.fields = next_fields
    if body.generated_prompt is not None:
        prompt.generated_prompt = body.generated_prompt
    if body.folder is not None:
        prompt.folder = body.folder
    if body.is_favorite is not None:
        prompt.is_favorite = body.is_favorite
    if body.tags is not None:
        prompt.tags = body.tags
    if body.variable_metadata is not None:
        prompt.variable_metadata = {k: v.model_dump() for k, v in body.variable_metadata.items()}

    prompt.updated_at = next_write_stamp(prompt.updated_at or prompt.created_at)

    db.commit()
    db.refresh(prompt)

    if was_unnamed and body.name is not None:
        prompts_saved_total.inc()

    _attach_run_counts(db, current_user.id, [prompt])
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
    Restore an owned prompt to a prior version's fields/generated_prompt.

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
    _attach_run_counts(db, current_user.id, [prompt])
    return prompt


@router.post("/{prompt_id}/playground/run", response_model=PlaygroundRunResponse)
@limiter.limit("10/minute")
def run_playground(
    request: Request,
    prompt_id: int,
    body: PlaygroundRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Compile an owned prompt's template with the given variables and run it
    against a model, recording latency/token/cost for Playground history and
    Dashboard usage analytics.

    Conservatively rate-limited (10/minute) since each call is a real,
    billed request against the user's own provider account.

    Args:
        request: Starlette request (used by rate limiter)
        prompt_id: Unique identifier of the prompt to test
        body: Model choice and template variable values
        db: Database session
        current_user: Current authenticated user

    Returns:
        The run's output text, latency, token usage, and computed cost

    Raises:
        HTTPException: If the prompt isn't found/owned, no provider is
            connected, the model isn't one this user's provider offers, a
            spend ceiling has been reached, or the API call fails
    """
    prompt = _get_owned_prompt(prompt_id, current_user.id, db)

    # The picker only offers models we know the user's provider serves; a
    # request for anything else is a stale client, not a valid free-text model.
    if body.model not in available_models_for(current_user):
        raise HTTPException(status_code=422, detail="Unsupported model")

    connection = get_llm_connection(current_user, body.model)

    try:
        BudgetService.check(db, current_user.id)
    except BudgetExceededError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc

    compiled_prompt = compile_prompt(prompt.generated_prompt, body.variables)

    playground_runs_total.inc()
    try:
        result = PlaygroundService.run(compiled_prompt, connection)
    except PlaygroundRunError as exc:
        playground_run_failures_total.inc()
        db.add(
            PlaygroundRun(
                prompt_id=prompt.id,
                user_id=current_user.id,
                model=body.model,
                input_variables=body.variables,
                status="error",
                error_message=str(exc),
            )
        )
        db.commit()

        if current_user.notify_run_failure and current_user.email:
            try:
                send_playground_run_failure_email(
                    current_user.email, prompt.name or "Untitled", str(exc)
                )
            except Exception:
                logger.exception("Failed to send Playground run-failure email")

        # PlaygroundRunError wraps the upstream exception, so unwrap it to get
        # provider-specific copy (bad key, unreachable endpoint, rate limit)
        # rather than a generic failure message.
        raise llm_http_error(exc.__cause__ or exc, connection, "playground run") from exc

    db.add(
        PlaygroundRun(
            prompt_id=prompt.id,
            user_id=current_user.id,
            model=body.model,
            input_variables=body.variables,
            output_text=result.output_text,
            latency_ms=result.latency_ms,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            cost_usd=result.cost_usd,
            status="success",
        )
    )
    record_billed_call(
        db,
        current_user.id,
        "playground",
        LLMUsage(
            provider=result.provider,
            model=result.model,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
        ),
    )
    db.commit()

    return PlaygroundRunResponse(
        output_text=result.output_text,
        latency_ms=result.latency_ms,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        cost_usd=result.cost_usd,
        model=body.model,
    )


@router.get("/{prompt_id}/playground/runs", response_model=list[PlaygroundRunHistoryResponse])
def get_playground_runs(
    prompt_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Retrieve the calling user's prior Playground runs for an owned prompt,
    newest first, for the Playground's history drawer / replay feature.

    Args:
        prompt_id: Unique identifier of the prompt whose runs to list
        limit: Maximum number of records to return
        offset: Number of records to skip, for paging past the first page
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of historical Playground runs (including failed attempts)

    Raises:
        HTTPException: If the prompt isn't found/owned
    """
    _get_owned_prompt(prompt_id, current_user.id, db)
    return (
        db.query(PlaygroundRun)
        .filter(PlaygroundRun.prompt_id == prompt_id, PlaygroundRun.user_id == current_user.id)
        .order_by(PlaygroundRun.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
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
    _attach_run_counts(db, current_user.id, [duplicated])
    return duplicated
