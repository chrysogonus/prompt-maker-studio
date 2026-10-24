"""
API route handlers for the Evaluate tab: eval case CRUD, running an
evaluation, run history, and manual star ratings.
"""

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import call_service, get_llm_connection, get_owned_prompt, llm_http_error
from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.limiter import limiter
from app.metrics import observe_operation
from app.models.eval_case import EvalCase
from app.models.user import User
from app.schemas.evaluation import (
    MAX_EVAL_CASES_PER_PROMPT,
    EvalCaseCreateRequest,
    EvalCaseGenerateRequest,
    EvalCaseGenerateResponse,
    EvalCaseResponse,
    EvalCaseUpdateRequest,
    EvalRunRateRequest,
    EvalRunRequest,
    EvalRunResponse,
)
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.eval_generator_service import EvalGeneratorService
from app.services.eval_service import EvalService
from app.services.evaluation import cases, results
from app.services.spend_ledger import bill_failed_attempts, record_billed_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prompts", tags=["eval"])

_MAX_PROPOSALS_PER_REQUEST = 10


@router.get("/{prompt_id}/eval/cases", response_model=list[EvalCaseResponse])
def list_eval_cases(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List an owned prompt's eval cases, in display order."""
    return call_service(cases.list_eval_cases, prompt_id, db, current_user.id)


@router.get("/{prompt_id}/eval/cases/export")
def export_eval_cases(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export an owned prompt's eval set as CSV."""
    content = call_service(cases.export_eval_cases, prompt_id, db, current_user.id)
    return Response(
        content=content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="prompt-{prompt_id}-eval-cases.csv"'
        },
    )


@router.post("/{prompt_id}/eval/cases/import", response_model=list[EvalCaseResponse])
@limiter.limit("10/minute")
def import_eval_cases(
    request: Request,
    prompt_id: int,
    body: bytes = Body(..., media_type="text/csv"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Validate and atomically append CSV rows to an owned prompt's eval set."""
    return call_service(cases.import_eval_cases, prompt_id, body, db, current_user.id)


@router.post("/{prompt_id}/eval/cases/generate", response_model=EvalCaseGenerateResponse)
@limiter.limit("10/minute")
@observe_operation("eval_generate")
def generate_eval_cases(
    request: Request,
    prompt_id: int,
    body: EvalCaseGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Propose a reviewable batch of eval cases (happy-path, edge-case,
    adversarial) from an owned prompt's current template. Proposals are
    never persisted here — the caller reviews and saves individual
    proposals via POST /{prompt_id}/eval/cases.

    Conservatively rate-limited (10/minute) to match other single-call
    billed eval/refine endpoints, since one request triggers one OpenAI call.

    Raises:
        HTTPException: If the prompt isn't found/owned, the eval set is
            already at its cap, a spend ceiling has been reached, or the
            underlying OpenAI API call fails outright
    """
    prompt = get_owned_prompt(prompt_id, current_user.id, db)

    existing = (
        db.query(EvalCase.name, EvalCase.method, EvalCase.criteria, EvalCase.variables)
        .filter(EvalCase.prompt_id == prompt.id)
        .order_by(EvalCase.position)
        .all()
    )
    existing_count = len(existing)
    if existing_count >= MAX_EVAL_CASES_PER_PROMPT:
        raise HTTPException(
            status_code=422,
            detail=f"A prompt can have at most {MAX_EVAL_CASES_PER_PROMPT} eval cases",
        )
    max_cases = min(_MAX_PROPOSALS_PER_REQUEST, MAX_EVAL_CASES_PER_PROMPT - existing_count)

    try:
        BudgetService.check(db, current_user.id)
    except BudgetExceededError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc

    connection = get_llm_connection(current_user)
    try:
        with bill_failed_attempts(db, current_user.id, "eval_generate"):
            proposals, usage = EvalGeneratorService.generate_proposals(
                prompt.generated_prompt,
                prompt.variable_metadata,
                body.goal,
                max_cases,
                connection,
                existing=[row._asdict() for row in existing],
            )
    except Exception as exc:
        raise llm_http_error(exc, connection, "eval/cases/generate") from exc

    record_billed_call(db, current_user.id, "eval_generate", usage)
    db.commit()

    return EvalCaseGenerateResponse(proposals=proposals)


@router.post("/{prompt_id}/eval/cases", response_model=EvalCaseResponse)
def create_eval_case(
    prompt_id: int,
    body: EvalCaseCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a new eval case to an owned prompt, capped at MAX_EVAL_CASES_PER_PROMPT."""
    return call_service(cases.create_eval_case, prompt_id, body, db, current_user.id)


@router.patch("/{prompt_id}/eval/cases/{case_id}", response_model=EvalCaseResponse)
def update_eval_case(
    prompt_id: int,
    case_id: int,
    body: EvalCaseUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Partially update an owned eval case."""
    return call_service(cases.update_eval_case, prompt_id, case_id, body, db, current_user.id)


@router.delete("/{prompt_id}/eval/cases/{case_id}", status_code=204)
def delete_eval_case(
    prompt_id: int,
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an owned eval case."""
    return call_service(cases.delete_eval_case, prompt_id, case_id, db, current_user.id)


@router.post("/{prompt_id}/eval/runs", response_model=EvalRunResponse)
@limiter.limit("10/minute")
@observe_operation("eval_run")
def create_eval_run(
    request: Request,
    prompt_id: int,
    body: EvalRunRequest | None = Body(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Run every eval case attached to an owned prompt against a real model and
    score the results. A body with `fields` tests those unsaved sections instead.

    Conservatively rate-limited (10/minute): each call can trigger one
    billed OpenAI Playground-style run per case, plus a grading call per
    Judge-method case.

    Raises:
        HTTPException: If the prompt isn't found/owned, a spend ceiling has
            been reached, or the underlying OpenAI API call fails outright
    """
    prompt = get_owned_prompt(prompt_id, current_user.id, db)

    connection = get_llm_connection(current_user)
    try:
        run = EvalService.run_evaluation(
            db, prompt, current_user, fields=body.fields if body else None
        )
    except BudgetExceededError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    except Exception as exc:
        raise llm_http_error(exc, connection, "eval run") from exc

    return results.describe_runs(db, prompt, [run])[0]


@router.get("/{prompt_id}/eval/runs", response_model=list[EvalRunResponse])
def list_eval_runs(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List an owned prompt's eval run history, newest first."""
    return call_service(results.list_eval_runs, prompt_id, db, current_user.id, limit, offset)


@router.post(
    "/{prompt_id}/eval/runs/{run_id}/results/{result_id}/rate", response_model=EvalRunResponse
)
def rate_eval_result(
    prompt_id: int,
    run_id: int,
    result_id: int,
    body: EvalRunRateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rate a pending Manual-method result, or a judge-scored result to measure agreement."""
    return call_service(
        results.rate_eval_result, prompt_id, run_id, result_id, body, db, current_user.id
    )
