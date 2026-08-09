"""
API route handlers for the Evaluate tab: eval case CRUD, running an
evaluation, run history, and manual star ratings.
"""

import csv
from io import StringIO
import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.deps import get_llm_connection, get_owned_prompt, llm_http_error
from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.limiter import limiter
from app.models.eval_case import EvalCase
from app.models.eval_run import EvalRun
from app.models.eval_run_result import EvalRunResult
from app.models.schemas import (
    MAX_EVAL_CASES_PER_PROMPT,
    EvalCaseCreateRequest,
    EvalCaseGenerateRequest,
    EvalCaseGenerateResponse,
    EvalCaseResponse,
    EvalCaseUpdateRequest,
    EvalRunRateRequest,
    EvalRunResponse,
)
from app.models.user import User
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.email_service import (
    send_eval_run_complete_email,
    send_eval_score_regression_email,
)
from app.services.eval_generator_service import EvalGeneratorService
from app.services.eval_service import EvalService
from app.services.spend_ledger import record_billed_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prompts", tags=["eval"])

_CSV_REQUIRED_HEADERS = ("method", "criteria")
_CSV_INTENTIONALLY_EMPTY_HEADER = "intentionally_empty"
_MAX_PROPOSALS_PER_REQUEST = 10


def _get_owned_case(prompt_id: int, case_id: int, user_id: int, db: Session) -> EvalCase:
    get_owned_prompt(prompt_id, user_id, db)
    case = (
        db.query(EvalCase).filter(EvalCase.id == case_id, EvalCase.prompt_id == prompt_id).first()
    )
    if not case:
        raise HTTPException(status_code=404, detail="Eval case not found")
    return case


def _notify_run_outcome(db: Session, prompt_name: str, user: User, run: EvalRun) -> None:
    """Best-effort completion/regression emails — never fails the request."""
    if run.score is None:
        return

    if user.notify_eval_complete and user.email:
        try:
            send_eval_run_complete_email(user.email, prompt_name, run.score)
        except Exception:
            logger.exception("Failed to send eval-run-complete email")

    if user.notify_eval_regression and user.email:
        previous = (
            db.query(EvalRun)
            .filter(
                EvalRun.prompt_id == run.prompt_id, EvalRun.id != run.id, EvalRun.score.isnot(None)
            )
            .order_by(EvalRun.created_at.desc())
            .first()
        )
        if previous is not None and run.score < previous.score:
            try:
                send_eval_score_regression_email(user.email, prompt_name, previous.score, run.score)
            except Exception:
                logger.exception("Failed to send eval-score-regression email")


@router.get("/{prompt_id}/eval/cases", response_model=list[EvalCaseResponse])
def list_eval_cases(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List an owned prompt's eval cases, in display order."""
    get_owned_prompt(prompt_id, current_user.id, db)
    return (
        db.query(EvalCase).filter(EvalCase.prompt_id == prompt_id).order_by(EvalCase.position).all()
    )


@router.get("/{prompt_id}/eval/cases/export")
def export_eval_cases(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export an owned prompt's eval set as CSV."""
    prompt = get_owned_prompt(prompt_id, current_user.id, db)
    cases = (
        db.query(EvalCase).filter(EvalCase.prompt_id == prompt.id).order_by(EvalCase.position).all()
    )
    variable_names = sorted({name for case in cases for name in (case.variables or {})})
    output = StringIO(newline="")
    writer = csv.DictWriter(
        output,
        fieldnames=[
            *_CSV_REQUIRED_HEADERS,
            "name",
            _CSV_INTENTIONALLY_EMPTY_HEADER,
            *variable_names,
        ],
    )
    writer.writeheader()
    for case in cases:
        writer.writerow(
            {
                "method": case.method,
                "criteria": case.criteria or "",
                "name": case.name or "",
                _CSV_INTENTIONALLY_EMPTY_HEADER: "true" if case.intentionally_empty else "false",
                **{name: (case.variables or {}).get(name, "") for name in variable_names},
            }
        )
    filename = f"prompt-{prompt.id}-eval-cases.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
    prompt = get_owned_prompt(prompt_id, current_user.id, db)
    try:
        csv_text = body.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="CSV must be UTF-8 encoded") from exc

    try:
        reader = csv.DictReader(StringIO(csv_text, newline=""), strict=True)
        headers = reader.fieldnames
        if not headers:
            raise HTTPException(status_code=422, detail="CSV header row is required")
        normalized_headers = [header.strip() for header in headers]
        if any(not header for header in normalized_headers) or len(set(normalized_headers)) != len(
            normalized_headers
        ):
            raise HTTPException(status_code=422, detail="CSV headers must be unique and non-empty")
        if normalized_headers[:2] != list(_CSV_REQUIRED_HEADERS):
            raise HTTPException(
                status_code=422, detail="CSV must begin with method,criteria columns"
            )

        metadata_headers = {
            header
            for header in ("name", _CSV_INTENTIONALLY_EMPTY_HEADER)
            if header in normalized_headers[2:]
        }
        variable_names = [
            header for header in normalized_headers[2:] if header not in metadata_headers
        ]
        parsed: list[EvalCaseCreateRequest] = []
        for row_number, raw_row in enumerate(reader, start=2):
            if None in raw_row:
                raise HTTPException(status_code=422, detail=f"Row {row_number}: too many columns")
            values = {(key or "").strip(): (value or "") for key, value in raw_row.items()}
            if not any(value.strip() for value in values.values()):
                continue
            try:
                intentionally_empty_value = values.get(_CSV_INTENTIONALLY_EMPTY_HEADER, "false")
                if intentionally_empty_value.strip().lower() not in {"", "false", "true"}:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Row {row_number}: intentionally_empty must be true or false",
                    )
                parsed.append(
                    EvalCaseCreateRequest(
                        method=values["method"].strip().lower(),
                        name=values.get("name") or None,
                        criteria=values["criteria"] or None,
                        variables={name: values[name] for name in variable_names},
                        intentionally_empty=intentionally_empty_value.strip().lower() == "true",
                    )
                )
            except ValidationError as exc:
                raise HTTPException(
                    status_code=422, detail=f"Row {row_number}: {exc.errors()[0]['msg']}"
                ) from exc
    except csv.Error as exc:
        raise HTTPException(status_code=422, detail=f"Malformed CSV: {exc}") from exc

    existing_count = db.query(EvalCase).filter(EvalCase.prompt_id == prompt.id).count()
    if existing_count + len(parsed) > MAX_EVAL_CASES_PER_PROMPT:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Import would exceed the maximum of {MAX_EVAL_CASES_PER_PROMPT} eval cases "
                f"(currently {existing_count})"
            ),
        )

    imported = [
        EvalCase(
            prompt_id=prompt.id,
            method=item.method,
            name=item.name,
            criteria=item.criteria,
            variables=item.variables,
            intentionally_empty=item.intentionally_empty,
            position=existing_count + index,
        )
        for index, item in enumerate(parsed)
    ]
    db.add_all(imported)
    db.commit()
    for case in imported:
        db.refresh(case)
    return imported


@router.post("/{prompt_id}/eval/cases/generate", response_model=EvalCaseGenerateResponse)
@limiter.limit("10/minute")
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

    existing_count = db.query(EvalCase).filter(EvalCase.prompt_id == prompt.id).count()
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
        proposals, usage = EvalGeneratorService.generate_proposals(
            prompt.generated_prompt, prompt.variable_metadata, body.goal, max_cases, connection
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
    prompt = get_owned_prompt(prompt_id, current_user.id, db)

    existing_count = db.query(EvalCase).filter(EvalCase.prompt_id == prompt.id).count()
    if existing_count >= MAX_EVAL_CASES_PER_PROMPT:
        raise HTTPException(
            status_code=422,
            detail=f"A prompt can have at most {MAX_EVAL_CASES_PER_PROMPT} eval cases",
        )

    case = EvalCase(
        prompt_id=prompt.id,
        method=body.method,
        name=body.name,
        criteria=body.criteria,
        variables=body.variables,
        intentionally_empty=body.intentionally_empty,
        position=existing_count,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@router.patch("/{prompt_id}/eval/cases/{case_id}", response_model=EvalCaseResponse)
def update_eval_case(
    prompt_id: int,
    case_id: int,
    body: EvalCaseUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Partially update an owned eval case."""
    case = _get_owned_case(prompt_id, case_id, current_user.id, db)

    if body.method is not None:
        case.method = body.method
    if body.name is not None:
        case.name = body.name or None
    if body.criteria is not None:
        case.criteria = body.criteria
    if body.variables is not None:
        case.variables = body.variables
    if body.intentionally_empty is not None:
        case.intentionally_empty = body.intentionally_empty

    db.commit()
    db.refresh(case)
    return case


@router.delete("/{prompt_id}/eval/cases/{case_id}", status_code=204)
def delete_eval_case(
    prompt_id: int,
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an owned eval case."""
    case = _get_owned_case(prompt_id, case_id, current_user.id, db)
    db.delete(case)
    db.commit()


@router.post("/{prompt_id}/eval/runs", response_model=EvalRunResponse)
@limiter.limit("10/minute")
def create_eval_run(
    request: Request,
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Run every eval case attached to an owned prompt against a real model and
    score the results.

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
        run = EvalService.run_evaluation(db, prompt, current_user)
    except BudgetExceededError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    except Exception as exc:
        raise llm_http_error(exc, connection, "eval run") from exc

    _notify_run_outcome(db, prompt.name or "Untitled", current_user, run)
    return run


@router.get("/{prompt_id}/eval/runs", response_model=list[EvalRunResponse])
def list_eval_runs(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List an owned prompt's eval run history, newest first."""
    get_owned_prompt(prompt_id, current_user.id, db)
    return (
        db.query(EvalRun)
        .filter(EvalRun.prompt_id == prompt_id)
        .order_by(EvalRun.created_at.desc())
        .all()
    )


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
    """Submit a 1-5 star manual rating for a pending Manual-method eval result."""
    prompt = get_owned_prompt(prompt_id, current_user.id, db)

    result = (
        db.query(EvalRunResult)
        .join(EvalRun, EvalRunResult.eval_run_id == EvalRun.id)
        .filter(
            EvalRunResult.id == result_id,
            EvalRunResult.eval_run_id == run_id,
            EvalRun.prompt_id == prompt.id,
        )
        .first()
    )
    if not result or not result.is_pending:
        raise HTTPException(status_code=404, detail="Pending eval result not found")

    run, just_finalized = EvalService.submit_manual_rating(db, result, body.stars)

    if just_finalized:
        _notify_run_outcome(db, prompt.name or "Untitled", current_user, run)

    return run
