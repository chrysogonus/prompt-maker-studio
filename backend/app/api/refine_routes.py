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
from app.metrics import observe_operation
from app.models.user import User
from app.schemas.refinement import (
    RefineDraftRequest,
    RefineDraftResponse,
    RefineQuestionsResponse,
    RefineSnapshotDraftRequest,
    RefineSnapshotDraftResponse,
    RefineSnapshotQuestionsRequest,
)
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.prompt_refiner import PromptRefinerService
from app.services.prompt_sections import render_sections
from app.services.spend_ledger import record_billed_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prompts", tags=["refine"])


@router.post("/refine/questions", response_model=RefineQuestionsResponse)
@limiter.limit("20/minute")
@observe_operation("refine_questions")
def get_snapshot_questions(
    request: Request,
    body: RefineSnapshotQuestionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ask about the editor's current sections without saving a prompt."""
    connection = get_llm_connection(current_user)
    try:
        BudgetService.check(db, current_user.id)
    except BudgetExceededError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    try:
        questions, usage = PromptRefinerService.generate_clarifying_questions(
            render_sections(field.model_dump() for field in body.fields),
            connection,
            force=body.force,
        )
    except Exception as exc:
        raise llm_http_error(exc, connection, "refine/questions snapshot") from exc
    record_billed_call(db, current_user.id, "refine_questions", usage)
    db.commit()
    return RefineQuestionsResponse(questions=questions)


@router.post("/refine/draft", response_model=RefineSnapshotDraftResponse)
@limiter.limit("10/minute")
@observe_operation("refine_draft")
def get_snapshot_draft(
    request: Request,
    body: RefineSnapshotDraftRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return validated section edits; applying and saving are separate user actions."""
    connection = get_llm_connection(current_user)
    try:
        BudgetService.check(db, current_user.id)
    except BudgetExceededError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    try:
        draft, usage = PromptRefinerService.generate_section_draft(
            body.fields,
            [(pair.question, pair.answer) for pair in body.qa_pairs],
            connection,
        )
    except Exception as exc:
        raise llm_http_error(exc, connection, "refine/draft snapshot") from exc
    # The completed call was billed even if the draft fails structural validation.
    record_billed_call(db, current_user.id, "refine_draft", usage)
    db.commit()
    try:
        fields = PromptRefinerService.validate_section_draft(body.fields, draft)
    except Exception as exc:
        raise llm_http_error(exc, connection, "refine/draft validation") from exc
    return RefineSnapshotDraftResponse(fields=fields)


@router.post("/{prompt_id}/refine/questions", response_model=RefineQuestionsResponse)
@limiter.limit("20/minute")
@observe_operation("refine_questions")
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
@observe_operation("refine_draft")
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
