"""
API route handlers for the Refine tab: AI-generated clarifying questions
and a draft revision incorporating the user's answers.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_llm_connection, get_owned_prompt, llm_http_error
from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.limiter import limiter
from app.models.schemas import (
    RefineDraftRequest,
    RefineDraftResponse,
    RefineQuestionsResponse,
)
from app.models.user import User
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.prompt_refiner import PromptRefinerService
from app.services.spend_ledger import record_billed_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prompts", tags=["refine"])


@router.post("/{prompt_id}/refine/questions", response_model=RefineQuestionsResponse)
@limiter.limit("20/minute")
def get_refine_questions(
    request: Request,
    prompt_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate clarifying questions about an owned prompt's current template.

    Raises:
        HTTPException: If the prompt isn't found/owned, no provider is
            connected, a spend ceiling has been reached, or the LLM call fails
    """
    prompt = get_owned_prompt(prompt_id, current_user.id, db)
    connection = get_llm_connection(current_user)

    try:
        BudgetService.check(db, current_user.id)
    except BudgetExceededError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc

    try:
        questions, usage = PromptRefinerService.generate_clarifying_questions(
            prompt.generated_prompt,
            connection,
            force=force,
        )
    except Exception as exc:
        raise llm_http_error(exc, connection, "refine/questions") from exc

    record_billed_call(db, current_user.id, "refine_questions", usage)
    db.commit()

    return RefineQuestionsResponse(questions=questions)


@router.post("/{prompt_id}/refine/draft", response_model=RefineDraftResponse)
@limiter.limit("10/minute")
def get_refine_draft(
    request: Request,
    prompt_id: int,
    body: RefineDraftRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate a draft revision of an owned prompt's template, incorporating
    the given clarifying-question answers.

    Raises:
        HTTPException: If the prompt isn't found/owned, no provider is
            connected, a spend ceiling has been reached, or the LLM call fails
    """
    prompt = get_owned_prompt(prompt_id, current_user.id, db)
    qa_pairs = [(qa.question, qa.answer) for qa in body.qa_pairs]
    connection = get_llm_connection(current_user)

    try:
        BudgetService.check(db, current_user.id)
    except BudgetExceededError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc

    try:
        draft, usage = PromptRefinerService.generate_draft(
            prompt.generated_prompt, qa_pairs, connection
        )
    except Exception as exc:
        raise llm_http_error(exc, connection, "refine/draft") from exc

    record_billed_call(db, current_user.id, "refine_draft", usage)
    db.commit()

    return RefineDraftResponse(draft=draft)
