"""Llm Connection HTTP endpoints."""

import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.limiter import limiter
from app.models.user import User
from app.schemas.connections import (
    LLMConnectionResponse,
    LLMConnectionTestResponse,
    LLMConnectionUpdate,
    ModelPriceInfo,
)
from app.services.llm_model_catalog import model_catalog_for

logger = logging.getLogger(__name__)
from app.services.accounts import connections

router = APIRouter(prefix="/api/auth", tags=["authentication"])


@router.get("/me/llm-connection", response_model=LLMConnectionResponse)
def get_llm_connection(current_user: User = Depends(get_current_user)):
    """
    The authenticated user's bring-your-own LLM provider connection, plus the
    catalogue of selectable providers for the Settings form.

    Returns:
        The connection's provider/base URL/model and whether a key is stored —
        never the key itself.
    """
    return deps.call_service(connections.get_llm_connection, current_user=current_user)


@router.get("/me/llm-connection/models", response_model=list[ModelPriceInfo])
def get_llm_connection_models(current_user: User = Depends(get_current_user)):
    """List models exposed by the caller's provider, enriched with pricing."""
    connection = deps.get_llm_connection(current_user)
    return model_catalog_for(current_user, connection)


@router.put("/me/llm-connection", response_model=LLMConnectionResponse)
@limiter.limit("10/minute")
def update_llm_connection(
    request: Request,
    body: LLMConnectionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create or replace the authenticated user's provider connection.

    `api_key` omitted keeps the stored key; an empty string clears it. Changing
    provider always requires a fresh key, since a credential issued by one
    vendor must never be presented to another.

    Raises:
        HTTPException 422: If the provider, base URL, model, or key is invalid
    """
    return deps.call_service(
        connections.update_llm_connection, body=body, current_user=current_user, db=db
    )


@router.delete("/me/llm-connection", response_model=LLMConnectionResponse)
def delete_llm_connection(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Disconnect the authenticated user's provider and erase the stored key.

    Returns:
        The now-empty connection state
    """
    return deps.call_service(connections.delete_llm_connection, current_user=current_user, db=db)


@router.post("/me/llm-connection/test", response_model=LLMConnectionTestResponse)
@limiter.limit("5/minute")
def test_llm_connection(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Send a one-token probe to the configured provider so a wrong endpoint, key,
    or model name is reported here rather than as a mystery failure inside a
    feature. Rate-limited: it is a real (if tiny) billed call.

    Goes through the budget check and the spend ledger like every other billed
    path. It used to skip both, which made it the one endpoint that kept
    spending after a ceiling was exhausted, and left its usage invisible to the
    Dashboard.

    Returns:
        {"ok": ..., "message": ...} — always 200; the failure detail is in the
        body so the form can render it inline.
    """
    return deps.call_service(connections.test_llm_connection, current_user=current_user, db=db)
