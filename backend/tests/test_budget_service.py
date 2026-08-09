"""
Unit tests for BudgetService — global/per-user monthly spend ceilings
evaluated against the unified billed_calls spend ledger — and for the
spend_ledger recording helpers.
"""

import pytest

from app.models.billed_call import BilledCall
from app.models.prompt import Prompt
from app.models.user import User
from app.services.budget_service import BudgetExceededError, BudgetService
from app.services.llm_pricing import cost_usd_for
from app.services.spend_ledger import LLMUsage, record_billed_call


def _make_user_and_prompt(db_session, username: str) -> tuple[User, Prompt]:
    user = User(username=username, hashed_password="x", email=f"{username}@example.com")
    db_session.add(user)
    db_session.flush()
    prompt = Prompt(user_id=user.id, fields=[], generated_prompt="p", name="P")
    db_session.add(prompt)
    db_session.flush()
    return user, prompt


def _add_run(db_session, prompt: Prompt, user: User, cost_usd: float) -> None:
    db_session.add(
        BilledCall(
            user_id=user.id,
            source="playground",
            model="gpt-4o-mini",
            cost_usd=cost_usd,
        )
    )
    db_session.commit()


class TestLimitParsing:
    def test_unset_env_means_no_limit(self, monkeypatch):
        monkeypatch.delenv("GLOBAL_MONTHLY_BUDGET_USD", raising=False)
        assert BudgetService.global_limit_usd() is None

    def test_blank_env_means_no_limit(self, monkeypatch):
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "")
        assert BudgetService.global_limit_usd() is None

    def test_invalid_env_means_no_limit(self, monkeypatch):
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "not-a-number")
        assert BudgetService.global_limit_usd() is None

    def test_negative_env_means_no_limit(self, monkeypatch):
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "-5")
        assert BudgetService.user_limit_usd() is None

    def test_valid_env_parses_to_float(self, monkeypatch):
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "12.5")
        assert BudgetService.user_limit_usd() == 12.5


class TestCheck:
    def test_no_limits_configured_never_raises(self, db_session, monkeypatch):
        monkeypatch.delenv("GLOBAL_MONTHLY_BUDGET_USD", raising=False)
        monkeypatch.delenv("USER_MONTHLY_BUDGET_USD", raising=False)
        user, prompt = _make_user_and_prompt(db_session, "u1")
        _add_run(db_session, prompt, user, cost_usd=1_000_000.0)

        BudgetService.check(db_session, user.id)  # should not raise

    def test_raises_when_global_ceiling_reached(self, db_session, monkeypatch):
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "1.0")
        monkeypatch.delenv("USER_MONTHLY_BUDGET_USD", raising=False)
        user, prompt = _make_user_and_prompt(db_session, "u2")
        _add_run(db_session, prompt, user, cost_usd=1.5)

        with pytest.raises(BudgetExceededError, match=r"(?i)budget"):
            BudgetService.check(db_session, user.id)

    def test_raises_when_user_ceiling_reached(self, db_session, monkeypatch):
        monkeypatch.delenv("GLOBAL_MONTHLY_BUDGET_USD", raising=False)
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "1.0")
        user, prompt = _make_user_and_prompt(db_session, "u3")
        _add_run(db_session, prompt, user, cost_usd=1.5)

        with pytest.raises(BudgetExceededError):
            BudgetService.check(db_session, user.id)

    def test_one_users_spend_does_not_exhaust_another_users_ceiling(self, db_session, monkeypatch):
        monkeypatch.delenv("GLOBAL_MONTHLY_BUDGET_USD", raising=False)
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "1.0")
        spender, spender_prompt = _make_user_and_prompt(db_session, "u4")
        other, _ = _make_user_and_prompt(db_session, "u5")
        _add_run(db_session, spender_prompt, spender, cost_usd=10.0)

        BudgetService.check(db_session, other.id)  # should not raise

    def test_under_ceiling_does_not_raise(self, db_session, monkeypatch):
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "100.0")
        monkeypatch.delenv("USER_MONTHLY_BUDGET_USD", raising=False)
        user, prompt = _make_user_and_prompt(db_session, "u6")
        _add_run(db_session, prompt, user, cost_usd=1.0)

        BudgetService.check(db_session, user.id)  # should not raise


class TestGlobalStatus:
    def test_unconfigured_reports_not_exhausted_and_no_remaining_figure(
        self, db_session, monkeypatch
    ):
        monkeypatch.delenv("GLOBAL_MONTHLY_BUDGET_USD", raising=False)
        status = BudgetService.global_status(db_session)
        assert status == {"budget_exhausted": False, "global_budget_remaining_usd": None}

    def test_configured_and_under_ceiling_reports_remaining(self, db_session, monkeypatch):
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "10.0")
        user, prompt = _make_user_and_prompt(db_session, "u7")
        _add_run(db_session, prompt, user, cost_usd=4.0)

        status = BudgetService.global_status(db_session)
        assert status["budget_exhausted"] is False
        assert status["global_budget_remaining_usd"] == 6.0

    def test_configured_and_at_ceiling_reports_exhausted(self, db_session, monkeypatch):
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "5.0")
        user, prompt = _make_user_and_prompt(db_session, "u8")
        _add_run(db_session, prompt, user, cost_usd=5.0)

        status = BudgetService.global_status(db_session)
        assert status["budget_exhausted"] is True
        assert status["global_budget_remaining_usd"] == 0.0


class TestSpendLedger:
    def test_cost_computed_from_pricing_table(self):
        # gpt-4o-mini: $0.15/1M input, $0.60/1M output
        assert cost_usd_for("openai", "gpt-4o-mini", 1_000_000, 1_000_000) == pytest.approx(0.75)

    def test_unknown_model_costs_zero(self):
        assert cost_usd_for("openai", "not-a-real-model", 1_000_000, 1_000_000) == 0.0

    def test_record_billed_call_adds_row_without_committing(self, db_session):
        user, _ = _make_user_and_prompt(db_session, "ledger-user")

        billed = record_billed_call(
            db_session,
            user.id,
            "refine_draft",
            LLMUsage(
                provider="openai",
                model="gpt-4o-mini",
                prompt_tokens=100_000,
                completion_tokens=50_000,
            ),
        )

        # Row is staged on the session but not committed — the caller owns the
        # transaction.
        assert billed in db_session.new
        assert billed.source == "refine_draft"
        assert billed.cost_usd == pytest.approx(
            cost_usd_for("openai", "gpt-4o-mini", 100_000, 50_000)
        )

        db_session.commit()
        stored = db_session.query(BilledCall).filter_by(user_id=user.id).one()
        assert stored.prompt_tokens == 100_000
        assert stored.completion_tokens == 50_000


class TestEstimatedCostPreCheck:
    """Regression tests for "monthly budget settings are soft tripwires rather
    than enforceable caps". `check` compared only already-recorded spend, so any
    headroom at all — a fraction of a cent — admitted a whole eval batch, which
    then spent up to 20 case calls plus judge grading before a single row
    reached the ledger.
    """

    def test_a_batch_that_would_cross_the_ceiling_is_refused(self, db_session, monkeypatch):
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "1.0")
        user, prompt = _make_user_and_prompt(db_session, "estimator")
        _add_run(db_session, prompt, user, 0.90)

        # Still under the ceiling, so the old check passed here.
        BudgetService.check(db_session, user.id)

        with pytest.raises(BudgetExceededError):
            BudgetService.check(db_session, user.id, estimated_cost_usd=0.5)

    def test_a_batch_that_fits_is_allowed(self, db_session, monkeypatch):
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "1.0")
        user, prompt = _make_user_and_prompt(db_session, "fits")
        _add_run(db_session, prompt, user, 0.10)

        BudgetService.check(db_session, user.id, estimated_cost_usd=0.05)

    def test_a_negative_estimate_cannot_buy_headroom(self, db_session, monkeypatch):
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "1.0")
        user, prompt = _make_user_and_prompt(db_session, "negative")
        _add_run(db_session, prompt, user, 1.5)

        with pytest.raises(BudgetExceededError):
            BudgetService.check(db_session, user.id, estimated_cost_usd=-100.0)

    def test_batch_estimate_scales_with_call_count(self, monkeypatch):
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "10.0")
        one = BudgetService.estimated_batch_cost_usd("openai", "gpt-4o-mini", calls=1)
        ten = BudgetService.estimated_batch_cost_usd("openai", "gpt-4o-mini", calls=10)

        assert one > 0
        assert ten == pytest.approx(one * 10)

    def test_batch_estimate_is_zero_without_a_ceiling(self, monkeypatch):
        monkeypatch.delenv("USER_MONTHLY_BUDGET_USD", raising=False)
        monkeypatch.delenv("GLOBAL_MONTHLY_BUDGET_USD", raising=False)

        assert BudgetService.estimated_batch_cost_usd("openai", "gpt-4o-mini", calls=20) == 0.0

    def test_unpriced_model_still_estimates_a_cost(self, monkeypatch):
        """Otherwise an unknown model is the cheapest way to ignore a ceiling."""
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "10.0")

        assert BudgetService.estimated_batch_cost_usd("openai", "no-such-model", calls=1) > 0


class TestUnknownCostAccounting:
    """The other half of the same finding: provider responses without usage
    became zero tokens and unknown hosted prices became $0, so either was an
    indefinite way around a configured cap."""

    def test_unpriced_model_is_not_recorded_as_free_when_a_ceiling_is_set(
        self, db_session, monkeypatch
    ):
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "5.0")
        user, _ = _make_user_and_prompt(db_session, "unpriced")

        billed = record_billed_call(
            db_session,
            user.id,
            "playground",
            LLMUsage(
                provider="openai", model="no-such-model", prompt_tokens=1000, completion_tokens=500
            ),
        )
        db_session.commit()

        assert billed.cost_usd > 0

    def test_unpriced_model_is_still_free_without_a_ceiling(self, db_session, monkeypatch):
        """No ceiling means nothing to protect, and inventing a cost would only
        distort the Dashboard."""
        monkeypatch.delenv("USER_MONTHLY_BUDGET_USD", raising=False)
        monkeypatch.delenv("GLOBAL_MONTHLY_BUDGET_USD", raising=False)
        user, _ = _make_user_and_prompt(db_session, "unpriced_free")

        billed = record_billed_call(
            db_session,
            user.id,
            "playground",
            LLMUsage(
                provider="openai", model="no-such-model", prompt_tokens=1000, completion_tokens=500
            ),
        )
        db_session.commit()

        assert billed.cost_usd == 0.0

    def test_missing_usage_on_a_priced_model_is_estimated(self, db_session, monkeypatch):
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "5.0")
        user, _ = _make_user_and_prompt(db_session, "nousage")

        billed = record_billed_call(
            db_session,
            user.id,
            "playground",
            LLMUsage(provider="openai", model="gpt-4o-mini", prompt_tokens=0, completion_tokens=0),
        )
        db_session.commit()

        assert billed.cost_usd > 0
        # Token counts stay truthful — only the cost is an estimate.
        assert billed.prompt_tokens == 0
        assert billed.completion_tokens == 0

    def test_self_hosted_providers_stay_free(self, db_session, monkeypatch):
        """Ollama and vLLM genuinely cost nothing per token: a known rate, not a
        missing one, so a ceiling must not start binding on them."""
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "5.0")
        user, _ = _make_user_and_prompt(db_session, "selfhosted")

        billed = record_billed_call(
            db_session,
            user.id,
            "playground",
            LLMUsage(provider="ollama", model="llama3", prompt_tokens=0, completion_tokens=0),
        )
        db_session.commit()

        assert billed.cost_usd == 0.0
