"""Owned evaluation history and manual ratings."""

from sqlalchemy.orm import Session, selectinload

from app.models.eval_run import EvalRun
from app.models.eval_run_result import EvalRunResult
from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion
from app.schemas.evaluation import EvalRunRateRequest
from app.services.errors import OperationError
from app.services.eval_service import EvalService
from app.services.prompt_version_service import PromptVersionService
from app.services.prompts.ownership import get_owned_prompt


def describe_runs(db: Session, prompt: Prompt, runs: list[EvalRun]) -> list[EvalRun]:
    """Set each run's `tested_version` (None for an unsaved draft never saved
    since) and whether it tested the prompt's current text."""
    live = PromptVersionService.live_version_number(db, prompt.id)
    saved_texts = None
    for run in runs:
        if run.tested_prompt is None:  # Before migration 031 only the number was kept.
            run.tested_version = run.prompt_version_number
            run.matches_current = run.prompt_version_number == live
            continue
        run.matches_current = run.tested_prompt == prompt.generated_prompt
        run.tested_version = run.prompt_version_number or None
        if run.tested_version is None:
            # A draft that was saved later belongs to the first version with its text.
            if saved_texts is None:
                saved_texts = [
                    *db.query(PromptVersion.version_number, PromptVersion.generated_prompt)
                    .filter(PromptVersion.prompt_id == prompt.id)
                    .order_by(PromptVersion.version_number),
                    (live, prompt.generated_prompt),
                ]
            run.tested_version = next(
                (number for number, text in saved_texts if text == run.tested_prompt), None
            )
    return runs


def list_eval_runs(prompt_id: int, db: Session, user_id: int, limit: int = 50, offset: int = 0):
    """List an owned prompt's eval run history, newest first."""
    prompt = get_owned_prompt(prompt_id, user_id, db)
    runs = (
        db.query(EvalRun)
        .options(selectinload(EvalRun.results))
        .filter(EvalRun.prompt_id == prompt_id)
        .order_by(EvalRun.created_at.desc(), EvalRun.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return describe_runs(db, prompt, runs)


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
        return describe_runs(db, prompt, [result.run])[0]
    if not result or not result.is_pending:
        raise OperationError(status_code=404, detail="Pending eval result not found")

    run, _ = EvalService.submit_manual_rating(db, result, body.stars)
    return describe_runs(db, prompt, [run])[0]
