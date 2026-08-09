"""
Unified AI spend ledger recording.

Every billed LLM call — Playground runs, eval case executions, judge grading,
eval-case generation, refinement, AI import — records a BilledCall row here so
BudgetService ceilings and Dashboard spend reflect real usage rather than only
Playground activity.

Since users bring their own provider credentials, a row records *which*
provider billed it: the same model name can be served by more than one
provider, and self-hosted providers are not billed per token at all.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.billed_call import BilledCall
from app.services.llm_pricing import (
    ASSUMED_TOKENS_WHEN_USAGE_MISSING,
    cost_usd_for,
    is_priced,
)


@dataclass
class LLMUsage:
    """Token usage from a single LLM call, as reported by response.usage."""

    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int


def record_billed_call(db: Session, user_id: int, source: str, usage: LLMUsage) -> BilledCall:
    """Add a ledger row for one billed call. Does NOT commit — the caller owns
    the transaction (eval runs batch many rows into one end-of-run commit)."""
    # Lazy import: budget_service imports the BilledCall model, and importing it
    # at module scope here closes a cycle through app.models.
    from app.services.budget_service import BudgetService

    # With a ceiling configured, a call whose cost cannot be determined must not
    # be recorded as free. Both unknowns — a compat endpoint that reported no
    # usage, and a hosted model with no published rate — resolved to $0, so a
    # cap could be bypassed indefinitely by using either. The recorded token
    # counts stay truthful; only the cost is estimated.
    guard_unknown_costs = BudgetService.any_limit_configured()
    prompt_tokens = usage.prompt_tokens
    completion_tokens = usage.completion_tokens
    estimated_tokens = False

    if (
        guard_unknown_costs
        and prompt_tokens == 0
        and completion_tokens == 0
        and is_priced(usage.provider, usage.model)
    ):
        # Priced model, but the endpoint told us nothing about usage.
        estimated_tokens = True

    cost = cost_usd_for(
        usage.provider,
        usage.model,
        ASSUMED_TOKENS_WHEN_USAGE_MISSING["input"] if estimated_tokens else prompt_tokens,
        ASSUMED_TOKENS_WHEN_USAGE_MISSING["output"] if estimated_tokens else completion_tokens,
        assume_cost_when_unknown=guard_unknown_costs,
    )

    billed = BilledCall(
        user_id=user_id,
        source=source,
        provider=usage.provider,
        model=usage.model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=cost,
    )
    db.add(billed)
    return billed
