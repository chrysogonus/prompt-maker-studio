"""
Unit tests for EvalService — rule/judge/manual scoring and aggregate
computation. The provider client and PlaygroundService are mocked.
"""

import json
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from app.models.billed_call import BilledCall
from app.models.eval_case import EvalCase
from app.models.eval_run import EvalRun
from app.models.eval_run_result import EvalRunResult
from app.models.prompt import Prompt
from app.models.user import User
from app.services.budget_service import BudgetService
from app.services.eval_service import (
    _JUDGE_OUTPUT_MAX_CHARS,
    _JUDGE_PROMPT_MAX_CHARS,
    EvalService,
    JudgeError,
    _split_criteria,
)
from app.services.playground_service import PlaygroundResult, PlaygroundRunError
from app.services.secret_store import encrypt_secret
from tests.conftest import (
    TEST_LLM_API_KEY,
    TEST_LLM_MODEL,
    TEST_LLM_PROVIDER,
    make_connection,
)


def _make_openai_judge_response(score: int, rationale: str) -> MagicMock:
    message = MagicMock()
    message.content = json.dumps({"score": score, "rationale": rationale})
    choice = MagicMock()
    choice.message = message
    usage = MagicMock()
    usage.prompt_tokens = 20
    usage.completion_tokens = 10
    response = MagicMock()
    response.choices = [choice]
    response.usage = usage
    return response


class TestSplitCriteria:
    def test_plain_commas_split_like_str_split(self):
        assert _split_criteria("hello, world,x") == ["hello", " world", "x"]

    def test_regex_with_brace_quantifier_stays_whole(self):
        assert _split_criteria(r"~\d{2,3}") == [r"~\d{2,3}"]

    def test_regex_with_group_splits_only_outside_brackets(self):
        assert _split_criteria("~(a|b),other") == ["~(a|b)", "other"]

    def test_json_operator_and_substring_split(self):
        assert _split_criteria("{json}, refund") == ["{json}", " refund"]

    def test_escaped_comma_is_literal(self):
        assert _split_criteria(r"a\,b,c") == [r"a\,b", "c"]

    def test_unmatched_opener_swallows_following_commas(self):
        # Documented edge case: an unclosed bracket keeps the rest as one term.
        assert _split_criteria("a(b,c") == ["a(b,c"]

    def test_empty_string(self):
        assert _split_criteria("") == [""]


class TestScoreRule:
    def test_all_required_terms_present(self):
        score, rationale = EvalService._score_rule("hello, world", "hello there, world!")
        assert score == 100.0
        assert "hello" in rationale.lower()

    def test_partial_match(self):
        score, rationale = EvalService._score_rule("hello, missing-term", "hello there")
        assert score == 50.0
        assert "missing-term" in rationale

    def test_no_match(self):
        score, rationale = EvalService._score_rule("xyz", "hello there")
        assert score == 0.0

    def test_empty_criteria_returns_none(self):
        score, rationale = EvalService._score_rule(None, "hello there")
        assert score is None
        assert "No criteria" in rationale

    def test_blank_criteria_returns_none(self):
        score, rationale = EvalService._score_rule("   ", "hello there")
        assert score is None

    def test_case_insensitive_match(self):
        score, _ = EvalService._score_rule("HELLO", "hello there")
        assert score == 100.0

    def test_json_operator_passes_on_valid_json(self):
        score, _ = EvalService._score_rule("{json}", '{"ok": true}')
        assert score == 100.0

    def test_json_operator_fails_on_invalid_json(self):
        score, rationale = EvalService._score_rule("{json}", "not json at all")
        assert score == 0.0
        assert "{json}" in rationale

    def test_regex_operator_match(self):
        score, _ = EvalService._score_rule(r"~\d+", "order 42 shipped")
        assert score == 100.0

    def test_regex_operator_no_match(self):
        score, _ = EvalService._score_rule(r"~\d+", "no digits here")
        assert score == 0.0

    def test_regex_with_comma_quantifier_is_one_term(self):
        score, _ = EvalService._score_rule(r"~\d{2,3}", "code 123")
        assert score == 100.0

    def test_invalid_regex_counts_as_miss_not_crash(self):
        score, rationale = EvalService._score_rule("~[unclosed", "anything")
        assert score == 0.0
        assert "~[unclosed" in rationale

    def test_forbidden_operator_hit_when_absent(self):
        score, _ = EvalService._score_rule("!sorry", "happy to help")
        assert score == 100.0

    def test_forbidden_operator_miss_when_present_case_insensitive(self):
        score, rationale = EvalService._score_rule("!sorry", "We are SORRY.")
        assert score == 0.0
        assert "!sorry" in rationale

    def test_mixed_operators(self):
        score, _ = EvalService._score_rule(
            r"refund, ~\d{2,3}, !sorry, {json}", '{"message": "refund of 120 approved"}'
        )
        assert score == 100.0


def _judge_connection(response) -> object:
    return make_connection(MagicMock(return_value=response))


class TestScoreJudge:
    def test_returns_score_and_rationale(self):
        connection = _judge_connection(_make_openai_judge_response(85, "Meets the rubric well."))

        result = EvalService._score_judge(
            "Be concise", "A short answer.", "Say something", connection
        )

        assert result.score == 85.0
        parsed = json.loads(result.rationale)
        assert parsed["text"] == "Meets the rubric well."
        # Judge grading runs on the user's own connection — there is no
        # operator-pinned judge model any more.
        assert result.provider == TEST_LLM_PROVIDER
        assert result.model == TEST_LLM_MODEL
        assert result.cost_usd >= 0

    def test_clamps_score_to_0_100_range(self):
        connection = _judge_connection(_make_openai_judge_response(150, "over"))
        result = EvalService._score_judge("criteria", "output", "prompt", connection)
        assert result.score == 100.0

    def test_uses_default_rubric_when_criteria_empty(self):
        mock_create = MagicMock(return_value=_make_openai_judge_response(50, "ok"))
        EvalService._score_judge(None, "output", "prompt", make_connection(mock_create))

        sent_content = mock_create.call_args.kwargs["messages"][1]["content"]
        assert "Overall quality" in sent_content

    def test_judge_sees_compiled_prompt(self):
        mock_create = MagicMock(return_value=_make_openai_judge_response(50, "ok"))
        EvalService._score_judge(
            "Be nice", "the output", "Summarize the ticket politely", make_connection(mock_create)
        )

        sent_content = mock_create.call_args.kwargs["messages"][1]["content"]
        assert "Prompt the model was given:" in sent_content
        assert "Summarize the ticket politely" in sent_content
        assert "Output to grade:" in sent_content

    def test_oversized_prompt_and_output_are_truncated(self):
        mock_create = MagicMock(return_value=_make_openai_judge_response(50, "ok"))
        EvalService._score_judge(
            "rubric",
            "o" * (_JUDGE_OUTPUT_MAX_CHARS + 100),
            "p" * (_JUDGE_PROMPT_MAX_CHARS + 100),
            make_connection(mock_create),
        )

        sent_content = mock_create.call_args.kwargs["messages"][1]["content"]
        assert sent_content.count("…[truncated]") == 2
        assert "p" * (_JUDGE_PROMPT_MAX_CHARS + 100) not in sent_content

    def _judge_with_content(self, content):
        message = MagicMock()
        message.content = content
        choice = MagicMock()
        choice.message = message
        response = MagicMock()
        response.choices = [choice]
        response.usage = None
        return EvalService._score_judge("rubric", "output", "prompt", _judge_connection(response))

    def test_raises_judge_error_on_non_json_content(self):
        with pytest.raises(JudgeError):
            self._judge_with_content("not json")

    def test_raises_judge_error_on_missing_score_key(self):
        with pytest.raises(JudgeError):
            self._judge_with_content(json.dumps({"rationale": "no score"}))

    def test_raises_judge_error_on_none_content(self):
        with pytest.raises(JudgeError):
            self._judge_with_content(None)

    def test_raises_judge_error_on_non_numeric_score(self):
        with pytest.raises(JudgeError):
            self._judge_with_content(json.dumps({"score": "high", "rationale": "x"}))


class TestRunEvaluation:
    def _make_prompt_with_cases(self, db_session, cases: list[dict]) -> Prompt:
        user = User(
            username="evaluser",
            hashed_password="x",
            email="eval@example.com",
            llm_provider=TEST_LLM_PROVIDER,
            llm_model=TEST_LLM_MODEL,
            llm_api_key_encrypted=encrypt_secret(TEST_LLM_API_KEY),
        )
        db_session.add(user)
        db_session.flush()

        prompt = Prompt(user_id=user.id, fields=[], generated_prompt="Say {{thing}}", name="P")
        db_session.add(prompt)
        db_session.flush()

        for i, case_kwargs in enumerate(cases):
            db_session.add(EvalCase(prompt_id=prompt.id, position=i, **case_kwargs))
        db_session.commit()
        db_session.refresh(prompt)
        return prompt, user

    def test_run_evaluation_rule_case(self, db_session):
        prompt, user = self._make_prompt_with_cases(
            db_session, [{"method": "rule", "criteria": "hello", "variables": {"thing": "hello"}}]
        )

        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.return_value = PlaygroundResult(
                output_text="hello world",
                latency_ms=42,
                prompt_tokens=10,
                completion_tokens=5,
                cost_usd=0.001,
                provider=TEST_LLM_PROVIDER,
                model=TEST_LLM_MODEL,
            )
            run = EvalService.run_evaluation(db_session, prompt, user)

        assert run.score == 100.0
        assert run.prompt_version_number == 1
        assert len(run.results) == 1
        assert run.results[0].is_pending is False
        # Reproducibility snapshot: resolved model, aggregate usage, and the
        # case's criteria/variables as they were at run time.
        # The run records the model from the user's own connection.
        assert run.model == TEST_LLM_MODEL
        assert run.total_latency_ms == 42
        assert run.total_prompt_tokens == 10
        assert run.total_completion_tokens == 5
        assert run.total_cost_usd == 0.001
        assert run.results[0].criteria == "hello"
        assert run.results[0].variables == {"thing": "hello"}
        assert run.results[0].judge_model is None

    def test_run_evaluation_manual_case_is_pending(self, db_session):
        prompt, user = self._make_prompt_with_cases(
            db_session, [{"method": "manual", "criteria": None, "variables": {}}]
        )

        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.return_value = PlaygroundResult(
                output_text="anything",
                latency_ms=1,
                prompt_tokens=1,
                completion_tokens=1,
                cost_usd=0.0,
                provider=TEST_LLM_PROVIDER,
                model=TEST_LLM_MODEL,
            )
            run = EvalService.run_evaluation(db_session, prompt, user)

        assert run.score is None
        assert run.results[0].is_pending is True
        assert run.results[0].output_text == "anything"

    def test_run_evaluation_judge_case(self, db_session):
        prompt, user = self._make_prompt_with_cases(
            db_session, [{"method": "judge", "criteria": "Be nice", "variables": {}}]
        )

        with (
            patch("app.services.eval_service.PlaygroundService.run") as mock_run,
            patch("app.services.llm_client.OpenAI") as mock_openai_cls,
        ):
            mock_run.return_value = PlaygroundResult(
                output_text="Nice output",
                latency_ms=1,
                prompt_tokens=1,
                completion_tokens=1,
                cost_usd=0.0,
                provider=TEST_LLM_PROVIDER,
                model=TEST_LLM_MODEL,
            )
            mock_openai_cls.return_value.chat.completions.create.return_value = (
                _make_openai_judge_response(90, "Very nice")
            )
            run = EvalService.run_evaluation(db_session, prompt, user)

        assert run.score == 90.0
        import json

        parsed = json.loads(run.results[0].rationale)
        assert parsed["text"] == "Very nice"
        # The judge call's own usage/cost is folded into the run's aggregate,
        # and the judge model actually used is snapshotted on the result.
        assert run.results[0].judge_model == TEST_LLM_MODEL
        assert run.total_prompt_tokens == 1 + 20
        assert run.total_completion_tokens == 1 + 10
        assert run.total_cost_usd > 0
        # Both billed calls land in the unified spend ledger.
        sources = sorted(b.source for b in db_session.query(BilledCall).all())
        assert sources == ["eval_case", "eval_judge"]
        judge_billed = db_session.query(BilledCall).filter_by(source="eval_judge").one()
        assert judge_billed.prompt_tokens == 20
        assert judge_billed.cost_usd > 0

    def test_run_evaluation_mixed_pending_and_scored_leaves_run_score_none(self, db_session):
        prompt, user = self._make_prompt_with_cases(
            db_session,
            [
                {"method": "rule", "criteria": "x", "variables": {}},
                {"method": "manual", "criteria": None, "variables": {}},
            ],
        )

        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.return_value = PlaygroundResult(
                output_text="x here",
                latency_ms=1,
                prompt_tokens=1,
                completion_tokens=1,
                cost_usd=0.0,
                provider=TEST_LLM_PROVIDER,
                model=TEST_LLM_MODEL,
            )
            run = EvalService.run_evaluation(db_session, prompt, user)

        assert run.score is None
        assert len(run.results) == 2

    def test_playground_run_error_does_not_abort_whole_run(self, db_session):
        prompt, user = self._make_prompt_with_cases(
            db_session,
            [
                {"method": "rule", "criteria": "x", "variables": {}},
                {"method": "rule", "criteria": "y", "variables": {}},
            ],
        )

        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.side_effect = [
                PlaygroundRunError("boom"),
                PlaygroundResult(
                    output_text="y here",
                    latency_ms=1,
                    prompt_tokens=1,
                    completion_tokens=1,
                    cost_usd=0.0,
                    provider=TEST_LLM_PROVIDER,
                    model=TEST_LLM_MODEL,
                ),
            ]
            # side_effect lists are consumed in call order, which is
            # nondeterministic across pool threads — force one worker so
            # call order matches case order.
            run = EvalService.run_evaluation(db_session, prompt, user, max_workers=1)

        assert len(run.results) == 2
        failed = [r for r in run.results if r.score is None]
        assert len(failed) == 1
        assert "Model run failed" in failed[0].rationale
        # The failed case is excluded from the aggregate; the successful one scores 100.
        assert run.score == 100.0

    def test_judge_parse_failure_captured_per_case(self, db_session):
        prompt, user = self._make_prompt_with_cases(
            db_session,
            [
                {"method": "judge", "criteria": "Be nice", "variables": {}},
                {"method": "rule", "criteria": "x", "variables": {}},
            ],
        )

        with (
            patch("app.services.eval_service.PlaygroundService.run") as mock_run,
            patch.object(
                EvalService, "_score_judge", side_effect=JudgeError("Unparseable judge response")
            ),
        ):
            mock_run.return_value = PlaygroundResult(
                output_text="x here",
                latency_ms=1,
                prompt_tokens=1,
                completion_tokens=1,
                cost_usd=0.0,
                provider=TEST_LLM_PROVIDER,
                model=TEST_LLM_MODEL,
            )
            run = EvalService.run_evaluation(db_session, prompt, user)

        assert len(run.results) == 2
        judge_result = next(r for r in run.results if r.method == "judge")
        assert judge_result.score is None
        assert judge_result.rationale.startswith("Judge grading failed")
        # The run still commits and aggregates over the remaining scored case.
        assert run.score == 100.0

    def test_run_evaluation_with_no_cases_has_none_score(self, db_session):
        prompt, user = self._make_prompt_with_cases(db_session, [])
        run = EvalService.run_evaluation(db_session, prompt, user)
        assert run.results == []
        assert run.score is None

    def test_cases_execute_in_parallel(self, db_session):
        """Both workers must be inside PlaygroundService.run at once for the
        barrier to release — sequential execution would deadlock the first
        call and fail the run."""
        prompt, user = self._make_prompt_with_cases(
            db_session,
            [
                {"method": "rule", "criteria": "out", "variables": {}},
                {"method": "rule", "criteria": "out", "variables": {}},
            ],
        )
        barrier = threading.Barrier(2, timeout=10)

        def fake_run(compiled, connection):
            barrier.wait()
            return PlaygroundResult(
                output_text="out",
                latency_ms=1,
                prompt_tokens=1,
                completion_tokens=1,
                cost_usd=0.0,
                provider=TEST_LLM_PROVIDER,
                model=TEST_LLM_MODEL,
            )

        with patch("app.services.eval_service.PlaygroundService.run", side_effect=fake_run):
            run = EvalService.run_evaluation(db_session, prompt, user)

        assert run.score == 100.0
        assert len(run.results) == 2

    def test_case_exceeding_timeout_records_failure_row(self, db_session, monkeypatch):
        prompt, user = self._make_prompt_with_cases(
            db_session, [{"method": "rule", "criteria": "x", "variables": {}}]
        )
        # The per-case ceiling derives from the provider timeout; shrink the
        # provider timeout so the derived ceiling is sub-second.
        monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "0.07")

        def slow_run(compiled, connection):
            time.sleep(1)
            return PlaygroundResult(
                output_text="x",
                latency_ms=1,
                prompt_tokens=1,
                completion_tokens=1,
                cost_usd=0.0,
                provider=TEST_LLM_PROVIDER,
                model=TEST_LLM_MODEL,
            )

        with patch("app.services.eval_service.PlaygroundService.run", side_effect=slow_run):
            run = EvalService.run_evaluation(db_session, prompt, user)

        assert run.results[0].score is None
        assert "timed out" in run.results[0].rationale
        assert run.score is None

    def test_budget_checked_once_per_run_before_dispatch(self, db_session):
        prompt, user = self._make_prompt_with_cases(
            db_session,
            [
                {"method": "judge", "criteria": "Be nice", "variables": {}},
                {"method": "judge", "criteria": "Be kind", "variables": {}},
            ],
        )

        with (
            patch("app.services.eval_service.PlaygroundService.run") as mock_run,
            patch("app.services.llm_client.OpenAI") as mock_openai_cls,
            patch.object(BudgetService, "check", wraps=BudgetService.check) as mock_check,
        ):
            mock_run.return_value = PlaygroundResult(
                output_text="Nice",
                latency_ms=1,
                prompt_tokens=1,
                completion_tokens=1,
                cost_usd=0.0,
                provider=TEST_LLM_PROVIDER,
                model=TEST_LLM_MODEL,
            )
            mock_openai_cls.return_value.chat.completions.create.return_value = (
                _make_openai_judge_response(90, "ok")
            )
            EvalService.run_evaluation(db_session, prompt, user)

        assert mock_check.call_count == 1

    def test_results_persist_in_case_order_under_parallelism(self, db_session):
        prompt, user = self._make_prompt_with_cases(
            db_session,
            [
                {"method": "rule", "criteria": "alpha", "variables": {"thing": "alpha"}},
                {"method": "rule", "criteria": "beta", "variables": {"thing": "beta"}},
            ],
        )

        def echo_run(compiled, connection):
            # Keyed on input, not call order — safe under any scheduling.
            return PlaygroundResult(
                output_text=compiled,
                latency_ms=1,
                prompt_tokens=1,
                completion_tokens=1,
                cost_usd=0.0,
                provider=TEST_LLM_PROVIDER,
                model=TEST_LLM_MODEL,
            )

        with patch("app.services.eval_service.PlaygroundService.run", side_effect=echo_run):
            run = EvalService.run_evaluation(db_session, prompt, user)

        assert [r.output_text for r in run.results] == ["Say alpha", "Say beta"]
        assert run.score == 100.0


class TestSubmitManualRating:
    def test_submit_rating_converts_stars_to_score(self, db_session):
        user = User(username="u2", hashed_password="x", email="u2@example.com")
        db_session.add(user)
        db_session.flush()
        prompt = Prompt(user_id=user.id, fields=[], generated_prompt="p", name="P")
        db_session.add(prompt)
        db_session.flush()
        run = EvalRun(prompt_id=prompt.id, prompt_version_number=0)
        db_session.add(run)
        db_session.flush()
        result = EvalRunResult(
            eval_run_id=run.id, method="manual", label="Case 1", is_pending=True, score=None
        )
        db_session.add(result)
        db_session.commit()

        updated_run, just_finalized = EvalService.submit_manual_rating(db_session, result, 4)

        assert result.score == 80
        assert result.is_pending is False
        assert just_finalized is True
        assert updated_run.score == 80.0

    def test_submit_rating_leaves_run_pending_if_other_results_still_pending(self, db_session):
        user = User(username="u3", hashed_password="x", email="u3@example.com")
        db_session.add(user)
        db_session.flush()
        prompt = Prompt(user_id=user.id, fields=[], generated_prompt="p", name="P")
        db_session.add(prompt)
        db_session.flush()
        run = EvalRun(prompt_id=prompt.id, prompt_version_number=0)
        db_session.add(run)
        db_session.flush()
        result_a = EvalRunResult(
            eval_run_id=run.id, method="manual", label="A", is_pending=True, score=None
        )
        result_b = EvalRunResult(
            eval_run_id=run.id, method="manual", label="B", is_pending=True, score=None
        )
        db_session.add_all([result_a, result_b])
        db_session.commit()

        _, just_finalized = EvalService.submit_manual_rating(db_session, result_a, 5)

        assert just_finalized is False
        db_session.refresh(run)
        assert run.score is None
