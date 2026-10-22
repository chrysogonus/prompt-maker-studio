"""
The free refiner: clarifying questions and a refined draft for a pasted prompt,
for visitors without an account. It runs on the operator's server default and is
off unless PUBLIC_REFINE_ENABLED is set. Per-IP limits sit on the routes; here
are the instance-wide guards: the shared and public monthly budgets and a daily
cap on calls. Each call reserves its ledger row, priced at a pessimistic
estimate, before contacting the provider, so calls still in flight count
against both. Nothing about the visitor is stored (models/public_billed_call.py).
"""

from datetime import UTC, datetime
from http import HTTPStatus
import os
import threading

from sqlalchemy.orm import Session

from app.models.public_billed_call import PublicBilledCall
from app.schemas.prompts import PromptField
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.errors import OperationError
from app.services.llm_client import LLMConnection, server_default, server_default_connection
from app.services.prompt_refiner import PromptRefinerService
from app.services.prompt_sections import render_sections
from app.services.spend_ledger import LLMUsage, capture_llm_usage, priced_usage

QUESTIONS_SOURCE = "public_refine_questions"
DRAFT_SOURCE = "public_refine_draft"
_DEFAULT_DAILY_LIMIT = 200
# The SDK retries a failed request once (llm_client: max_retries=1).
_ATTEMPTS_PER_CALL = 2

# ponytail: one backend process (run.py), so a lock makes check-and-reserve atomic;
# a database-level counter is needed if the backend ever runs several workers.
_admission = threading.Lock()


def is_enabled() -> bool:
    return os.getenv("PUBLIC_REFINE_ENABLED", "false").strip().lower() in {"true", "1", "yes"}


def is_available() -> bool:
    """Whether the page should offer refinement at all; limits are checked per call."""
    return is_enabled() and server_default() is not None


def daily_limit() -> int:
    """Calls per UTC day across all visitors; unset or invalid uses the default."""
    try:
        return max(0, int(os.getenv("PUBLIC_REFINE_DAILY_LIMIT", _DEFAULT_DAILY_LIMIT)))
    except ValueError:
        return _DEFAULT_DAILY_LIMIT


def _calls_today(db: Session) -> int:
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return db.query(PublicBilledCall).filter(PublicBilledCall.created_at >= start).count()


def available_connection() -> LLMConnection:
    """The server default, when the free refiner is switched on."""
    if not is_enabled():
        raise OperationError(status_code=HTTPStatus.NOT_FOUND, detail="Not Found")
    connection = server_default_connection()
    if connection is None:
        raise OperationError(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
            detail="Free refinement is unavailable on this server. Sign in to use your own AI provider.",
        )
    return connection


def reserve_call(db: Session, connection: LLMConnection, source: str) -> PublicBilledCall:
    """Admit one call under the daily cap and budgets, and hold its place in the
    ledger at an estimated cost until `settle_call` records what it really cost."""
    estimate = BudgetService.estimated_batch_cost_usd(
        connection.provider_handle, connection.model, _ATTEMPTS_PER_CALL
    )
    with _admission:
        if _calls_today(db) >= daily_limit():
            raise OperationError(
                status_code=HTTPStatus.TOO_MANY_REQUESTS,
                detail="The free refiner has reached today's limit. Please try again tomorrow, or sign in to use your own AI provider.",
            )
        try:
            BudgetService.check_public(db, estimate)
        except BudgetExceededError as exc:
            raise OperationError(status_code=HTTPStatus.PAYMENT_REQUIRED, detail=str(exc)) from exc
        row = PublicBilledCall(
            source=source,
            provider=connection.provider_handle,
            model=connection.model,
            cost_usd=estimate,
        )
        db.add(row)
        db.commit()
    return row


def settle_call(db: Session, row: PublicBilledCall, usages: list[LLMUsage]) -> None:
    """Replace the reservation's estimate with the spend the provider reported
    (none for a call that failed before any response)."""
    if usages:
        row.provider, row.model = usages[-1].provider, usages[-1].model
    priced = [priced_usage(usage) for usage in usages]
    row.prompt_tokens = sum(tokens[0] for tokens in priced)
    row.completion_tokens = sum(tokens[1] for tokens in priced)
    row.cost_usd = sum(tokens[2] for tokens in priced)
    db.commit()


def refine_questions(
    db: Session, connection: LLMConnection, row: PublicBilledCall, text: str, force: bool
) -> list[str]:
    with capture_llm_usage() as captured:
        try:
            questions, usage = PromptRefinerService.generate_clarifying_questions(
                render_sections([{"name": "Task", "content": text}]), connection, force=force
            )
        except Exception:
            settle_call(db, row, captured)
            raise
        settle_call(db, row, captured or [usage])
    return questions


def refine_draft(
    db: Session,
    connection: LLMConnection,
    row: PublicBilledCall,
    text: str,
    qa_pairs: list[tuple[str, str]],
) -> str:
    fields = [PromptField(name="Task", content=text)]
    with capture_llm_usage() as captured:
        try:
            draft, usage = PromptRefinerService.generate_section_draft(fields, qa_pairs, connection)
        except Exception:
            settle_call(db, row, captured)
            raise
        # The completed call is billed even if the draft then fails validation.
        settle_call(db, row, captured or [usage])
    return PromptRefinerService.validate_section_draft(fields, draft)[0].content
