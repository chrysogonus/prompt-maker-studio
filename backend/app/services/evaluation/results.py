"""Owned evaluation history and manual ratings."""

from sqlalchemy.orm import Session, selectinload

from app.models.eval_run import EvalRun
from app.models.eval_run_result import EvalRunResult
from app.schemas.evaluation import EvalRunRateRequest
from app.services.errors import OperationError
from app.services.eval_service import EvalService
from app.services.prompts.ownership import get_owned_prompt


def list_eval_runs(prompt_id: int, db: Session, user_id: int, limit: int = 50, offset: int = 0):
    """List an owned prompt's eval run history, newest first."""
    get_owned_prompt(prompt_id, user_id, db)
    return (
        db.query(EvalRun)
        .options(selectinload(EvalRun.results))
        .filter(EvalRun.prompt_id == prompt_id)
        .order_by(EvalRun.created_at.desc(), EvalRun.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def rate_eval_result(
    prompt_id: int, run_id: int, result_id: int, body: EvalRunRateRequest, db: Session, user_id: int
):
    """Rate a pending Manual-method result, or record a person's own rating of
    a judge-scored result beside the AI's score. Either rating is final."""
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
    if result and result.method == "judge" and result.score is not None:
        if result.human_score is not None:
            raise OperationError(status_code=404, detail="Unrated eval result not found")
        # The run's aggregate stays the AI's: this rating only measures agreement.
        result.human_score = body.stars * 20
        db.commit()
        db.refresh(result.run)
        return result.run
    if not result or not result.is_pending:
        raise OperationError(status_code=404, detail="Pending eval result not found")

    run, _ = EvalService.submit_manual_rating(db, result, body.stars)
    return run
