"""Owned evaluation history and manual ratings."""

from sqlalchemy.orm import Session

from app.models.eval_run import EvalRun
from app.models.eval_run_result import EvalRunResult
from app.schemas.evaluation import EvalRunRateRequest
from app.services.errors import OperationError
from app.services.eval_service import EvalService
from app.services.prompts.ownership import get_owned_prompt


def list_eval_runs(prompt_id: int, db: Session, user_id: int):
    """List an owned prompt's eval run history, newest first."""
    get_owned_prompt(prompt_id, user_id, db)
    return (
        db.query(EvalRun)
        .filter(EvalRun.prompt_id == prompt_id)
        .order_by(EvalRun.created_at.desc())
        .all()
    )


def rate_eval_result(
    prompt_id: int, run_id: int, result_id: int, body: EvalRunRateRequest, db: Session, user_id: int
):
    """Submit a 1-5 star manual rating for a pending Manual-method eval result."""
    prompt = get_owned_prompt(prompt_id, user_id, db)

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
        raise OperationError(status_code=404, detail="Pending eval result not found")

    run, _ = EvalService.submit_manual_rating(db, result, body.stars)
    return run
