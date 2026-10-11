"""
Shared FastAPI route dependencies used across multiple router modules.
"""

from collections.abc import Callable
import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.prompt import Prompt
from app.models.user import User
from app.services.errors import OperationError
from app.services.llm_client import (
    LLMConnection,
    LLMConnectionError,
    client_for,
    describe_llm_error,
)
from app.services.prompts.ownership import get_owned_prompt as owned_prompt

logger = logging.getLogger(__name__)


def call_service[T](operation: Callable[..., T], *args, **kwargs) -> T:
    """Translate expected operation failures at the HTTP boundary."""
    try:
        return operation(*args, **kwargs)
    except OperationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def get_llm_connection(user: User, model: str | None = None) -> LLMConnection:
    """
    Resolve the acting user's own provider connection for an AI-backed route.

    A missing or unusable connection is a 422 with actionable copy rather than
    a 502: nothing upstream failed, the user simply has not connected a
    provider yet (or needs to re-enter a key).
    """
    try:
        return client_for(user, model)
    except LLMConnectionError as exc:
        status_code, detail = describe_llm_error(exc, None)
        raise HTTPException(status_code=status_code, detail=detail) from exc


def llm_http_error(exc: Exception, connection: LLMConnection | None, context: str) -> HTTPException:
    """Translate an upstream provider failure into a provider-neutral
    HTTPException, logging the underlying detail server-side."""
    status_code, detail = describe_llm_error(exc, connection)
    logger.error("LLM error in %s: %s", context, exc)
    return HTTPException(status_code=status_code, detail=detail)


def get_owned_prompt(prompt_id: int, user_id: int, db: Session) -> Prompt:
    """
    Fetch a prompt that belongs to the given user.
    Returns 404 for both missing prompts and prompts owned by another user,
    so the response does not reveal whether a resource exists at all.
    """
    return call_service(owned_prompt, prompt_id, user_id, db)
