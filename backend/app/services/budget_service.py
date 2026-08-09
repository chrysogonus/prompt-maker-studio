"""
Service enforcing optional global and per-user monthly spend ceilings, based on
the unified `billed_calls` spend ledger (written by every billed LLM call path
— Playground, eval case/judge, eval-case generation, refinement, AI import —
see services/spend_ledger.py). Checked before every billed call so a runaway
request is rejected before money is spent, not after.

Since users now bring their own provider credentials, these ceilings no longer
protect an operator's wallet — the user pays their own provider directly. They
remain useful as *usage guard rails*: a shared or demo deployment can still cap
how much activity the app will drive on anyone's behalf, and a per-user ceiling
still stops one runaway loop from burning that user's own quota. Self-hosted
providers price at 0.0 (see services/llm_pricing.py), so ceilings simply never
bind for an Ollama or vLLM connection. See product/DECISIONS.md.
"""

from datetime import UTC, datetime
import os

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.billed_call import BilledCall
from app.services.llm_pricing import ASSUMED_TOKENS_WHEN_USAGE_MISSING, cost_usd_for


class BudgetExceededError(Exception):
    """Raised when a spend ceiling has been reached; message is safe to show the user."""


def _month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _limit_from_env(name: str) -> float | None:
    """Unset (or blank) means "no ceiling" — budgets are opt-in so existing
    deployments aren't suddenly blocked by upgrading."""
    raw = os.getenv(name)
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if value >= 0 else None


class BudgetService:
    """Enforces GLOBAL_MONTHLY_BUDGET_USD / USER_MONTHLY_BUDGET_USD ceilings."""

    @staticmethod
    def global_limit_usd() -> float | None:
        return _limit_from_env("GLOBAL_MONTHLY_BUDGET_USD")

    @staticmethod
    def user_limit_usd() -> float | None:
        return _limit_from_env("USER_MONTHLY_BUDGET_USD")

    @staticmethod
    def _spent_since(db: Session, start: datetime, user_id: int | None) -> float:
        query = db.query(func.coalesce(func.sum(BilledCall.cost_usd), 0.0)).filter(
            BilledCall.created_at >= start
        )
        if user_id is not None:
            query = query.filter(BilledCall.user_id == user_id)
        return float(query.scalar() or 0.0)

    @staticmethod
    def any_limit_configured() -> bool:
        """Whether either ceiling is set.

        Callers use this to decide whether unknown costs need conservative
        treatment: with no ceiling configured there is nothing to protect, and
        inventing a cost would only distort the Dashboard.
        """
        return (
            BudgetService.global_limit_usd() is not None
            or BudgetService.user_limit_usd() is not None
        )

    @staticmethod
    def check(db: Session, user_id: int, estimated_cost_usd: float = 0.0) -> None:
        """
        Raise BudgetExceededError if a ceiling has been reached, or would be by
        spending `estimated_cost_usd` more. Call before any billed LLM call.

        `estimated_cost_usd` is what stops a ceiling from being a pure tripwire.
        Comparing only already-recorded spend means a batch is admitted whenever
        there is any headroom at all, however small, and can then overshoot by
        the whole batch — an eval fires up to 20 case calls plus judge calls
        before any of them reach the ledger. Passing a conservative estimate for
        the work about to be done bounds that.

        It is not a reservation: two concurrent requests can still each pass
        with the same headroom. Serialising spend would need a reservation
        ledger, which is deliberately out of scope — see docs and
        product/FEATURES.md.
        """
        window_start = _month_start(datetime.now(UTC))
        estimate = max(0.0, estimated_cost_usd)

        global_limit = BudgetService.global_limit_usd()
        if global_limit is not None:
            global_spent = BudgetService._spent_since(db, window_start, user_id=None)
            if global_spent + estimate >= global_limit:
                msg = (
                    "The shared monthly API budget has been reached. "
                    "Please try again after the budget resets next month."
                )
                raise BudgetExceededError(msg)

        user_limit = BudgetService.user_limit_usd()
        if user_limit is not None:
            user_spent = BudgetService._spent_since(db, window_start, user_id=user_id)
            if user_spent + estimate >= user_limit:
                msg = (
                    "Your monthly API budget has been reached. "
                    "Please try again after the budget resets next month."
                )
                raise BudgetExceededError(msg)

    @staticmethod
    def estimated_batch_cost_usd(provider: str, model: str, calls: int) -> float:
        """A deliberately pessimistic cost for `calls` upcoming LLM calls.

        Used to pre-check work that spends before any of it reaches the ledger.
        Overestimating is the safe direction here: too high refuses a run near
        the ceiling, too low is the overshoot this exists to bound. Returns 0.0
        when no ceiling is configured, so an unconstrained deployment pays no
        attention to it.
        """
        if not BudgetService.any_limit_configured():
            return 0.0
        per_call = cost_usd_for(
            provider,
            model,
            ASSUMED_TOKENS_WHEN_USAGE_MISSING["input"],
            ASSUMED_TOKENS_WHEN_USAGE_MISSING["output"],
            assume_cost_when_unknown=True,
        )
        return per_call * max(0, calls)

    @staticmethod
    def global_status(db: Session) -> dict:
        """
        Global-only snapshot for the GET /api/prompts/config capability check.

        That endpoint is authenticated like every other one; the figure it
        reports is instance-wide because a shared ceiling is instance-wide
        state — knowing the global budget is exhausted is what tells the
        frontend to disable AI actions, regardless of who is asking.
        """
        global_limit = BudgetService.global_limit_usd()
        if global_limit is None:
            return {"budget_exhausted": False, "global_budget_remaining_usd": None}

        window_start = _month_start(datetime.now(UTC))
        spent = BudgetService._spent_since(db, window_start, user_id=None)
        remaining = round(max(0.0, global_limit - spent), 6)
        return {"budget_exhausted": spent >= global_limit, "global_budget_remaining_usd": remaining}
