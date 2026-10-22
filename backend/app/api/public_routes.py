"""Unauthenticated endpoints behind the free tools for signed-out visitors."""

import os

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import call_service, llm_http_error
from app.database.connection import get_db
from app.limiter import limiter
from app.metrics import observe_operation
from app.schemas.public import (
    PublicModelPrice,
    PublicRefineDraftRequest,
    PublicRefineDraftResponse,
    PublicRefineQuestionsRequest,
    PublicRefineStatus,
)
from app.schemas.refinement import RefineQuestionsResponse
from app.services import public_refine, public_tools

router = APIRouter(prefix="/api/public", tags=["public"])

# Per visitor IP; the daily cap and budgets in services/public_refine.py bound the total.
_PUBLIC_REFINE_RATE_LIMIT = os.getenv("PUBLIC_REFINE_RATE_LIMIT", "6/minute;30/day")


@router.get("/model-prices", response_model=list[PublicModelPrice])
@limiter.limit("60/minute")
def get_model_prices(request: Request):
    """Curated hosted models with estimated per-million-token prices. Public data."""
    return public_tools.hosted_model_prices()


@router.get("/refine", response_model=PublicRefineStatus)
@limiter.limit("60/minute")
def public_refine_status(request: Request):
    """Whether the free refiner is offered here, so the page can say so up front."""
    return PublicRefineStatus(available=public_refine.is_available())


# One bucket for both steps, so a visitor's allowance is not doubled across them.
_public_refine_limit = limiter.shared_limit(_PUBLIC_REFINE_RATE_LIMIT, scope="public_refine")


@router.post("/refine/questions", response_model=RefineQuestionsResponse)
@_public_refine_limit
@observe_operation("public_refine_questions")
def public_refine_questions(
    request: Request, body: PublicRefineQuestionsRequest, db: Session = Depends(get_db)
):
    """Clarifying questions for a pasted prompt, without an account. Off unless
    PUBLIC_REFINE_ENABLED is set; uses the server default connection."""
    connection = call_service(public_refine.available_connection)
    row = call_service(
        public_refine.reserve_call, db, connection, public_refine.QUESTIONS_SOURCE, len(body.text)
    )
    try:
        questions = public_refine.refine_questions(db, connection, row, body.text, body.force)
    except Exception as exc:
        raise llm_http_error(exc, connection, "public refine/questions") from exc
    return RefineQuestionsResponse(questions=questions)


@router.post("/refine/draft", response_model=PublicRefineDraftResponse)
@_public_refine_limit
@observe_operation("public_refine_draft")
def public_refine_draft(
    request: Request, body: PublicRefineDraftRequest, db: Session = Depends(get_db)
):
    """A refined version of a pasted prompt, using any answered questions."""
    connection = call_service(public_refine.available_connection)
    pairs = [(pair.question, pair.answer) for pair in body.qa_pairs if pair.answer.strip()]
    input_chars = len(body.text) + sum(len(question) + len(answer) for question, answer in pairs)
    row = call_service(
        public_refine.reserve_call, db, connection, public_refine.DRAFT_SOURCE, input_chars
    )
    try:
        text = public_refine.refine_draft(db, connection, row, body.text, pairs)
    except Exception as exc:
        raise llm_http_error(exc, connection, "public refine/draft") from exc
    return PublicRefineDraftResponse(text=text)
