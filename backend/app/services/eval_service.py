"""
Service for running a prompt's eval set (Evaluate tab): compiles and runs
each case against a real model, then scores the output by the case's method
(rule/judge/manual).
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import json
import re
import time

from openai import OpenAIError
from sqlalchemy.orm import Session

from app.models.eval_case import EvalCase
from app.models.eval_run import EvalRun
from app.models.eval_run_result import EvalRunResult
from app.models.prompt import Prompt
from app.models.user import User
from app.services.budget_service import BudgetService
from app.services.llm_client import (
    LLMConnection,
    LLMResponseFormatError,
    client_for,
    json_completion,
    timeout_seconds_for,
)
from app.services.llm_pricing import cost_usd_for
from app.services.playground_service import (
    PlaygroundResult,
    PlaygroundRunError,
    PlaygroundService,
)
from app.services.prompt_compiler import compile_prompt
from app.services.prompt_version_service import PromptVersionService
from app.services.safe_regex import UnsafePatternError, safe_search
from app.services.spend_ledger import LLMUsage, record_billed_call

_JUDGE_SYSTEM_PROMPT = (
    "You are grading an AI model's output against a rubric. You are shown the "
    "prompt the model received (as context for what was asked) and the output "
    "it produced. Grade only the output. Return a score from 0 to 100 "
    "(100 = fully satisfies the rubric), short lists of strengths and "
    "weaknesses, and a one or two sentence rationale."
)

# Caps on how much of the compiled prompt / model output is sent to the judge,
# so a pathological case can't blow up judge token spend.
_JUDGE_PROMPT_MAX_CHARS = 6_000
_JUDGE_OUTPUT_MAX_CHARS = 12_000


class JudgeError(Exception):
    """Judge response could not be parsed into a valid judgment."""


_JUDGE_RESPONSE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "eval_judgment",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "score": {"type": "integer"},
                "strengths": {"type": "array", "items": {"type": "string"}},
                "weaknesses": {"type": "array", "items": {"type": "string"}},
                "rationale": {"type": "string"},
            },
            "required": ["score", "strengths", "weaknesses", "rationale"],
            "additionalProperties": False,
        },
    },
}

_LABEL_MAX_LENGTH = 60

# Cases run concurrently (each is one or two blocking provider calls); five at
# a time keeps a 20-case run fast without hammering the user's rate limits.
_DEFAULT_MAX_WORKERS = 5

# Ceiling on waiting for one case's worker, as a multiple of the provider's own
# per-request timeout: a case is at most two sequential calls (the run, then
# judge grading), plus slack for scheduling. Anything past that means a hung
# thread — record a failure row instead of hanging the whole HTTP request.
# Deriving it matters for self-hosted providers, whose per-request ceiling is
# far higher than a hosted API's.
_CASE_TIMEOUT_MULTIPLIER = 3.0


def _case_timeout_seconds(connection: LLMConnection) -> float:
    return timeout_seconds_for(connection.provider) * _CASE_TIMEOUT_MULTIPLIER


_BRACKET_OPENERS = "([{"
_BRACKET_CLOSERS = ")]}"


def _split_criteria(criteria: str) -> list[str]:
    """Split criteria on commas not nested inside (), [], {} and not escaped
    with a backslash, so regex terms like ~\\d{2,3} survive as one term.
    Plain comma-separated substrings tokenize exactly as str.split(",")."""
    terms: list[str] = []
    current: list[str] = []
    depth = 0
    escaped = False
    for char in criteria:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            current.append(char)
            escaped = True
        elif char in _BRACKET_OPENERS:
            depth += 1
            current.append(char)
        elif char in _BRACKET_CLOSERS:
            depth = max(0, depth - 1)
            current.append(char)
        elif char == "," and depth == 0:
            terms.append("".join(current))
            current = []
        else:
            current.append(char)
    terms.append("".join(current))
    return terms


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…[truncated]"


@dataclass
class _UsageTotals:
    """Accumulates latency/tokens/cost across a run's case + judge calls —
    both PlaygroundResult and JudgeResult expose the same four fields."""

    latency_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0

    def add(self, usage) -> None:
        self.latency_ms += usage.latency_ms
        self.prompt_tokens += usage.prompt_tokens
        self.completion_tokens += usage.completion_tokens
        self.cost_usd += usage.cost_usd

    def apply_to(self, run: EvalRun) -> None:
        run.total_latency_ms = self.latency_ms
        run.total_prompt_tokens = self.prompt_tokens
        run.total_completion_tokens = self.completion_tokens
        run.total_cost_usd = round(self.cost_usd, 6)


@dataclass
class JudgeResult:
    """Outcome of a Judge-method grading call, plus its own billed usage —
    kept separate from the case's own PlaygroundResult so both can be
    aggregated into the eval run's total cost/latency/tokens."""

    score: float
    rationale: str
    provider: str
    model: str
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float


@dataclass
class _CaseOutcome:
    """What one case's worker thread produced — plain values only, so workers
    never touch the (non-thread-safe) SQLAlchemy session or ORM objects."""

    result: PlaygroundResult | None = None
    run_error: str | None = None
    judge_result: JudgeResult | None = None
    judge_error: str | None = None


class EvalService:
    """Runs a prompt's eval cases and scores the results."""

    @staticmethod
    def _label_for(case: EvalCase, index: int) -> str:
        if case.name and case.name.strip():
            return case.name.strip()
        if case.criteria:
            trimmed = case.criteria.strip()
            if len(trimmed) > _LABEL_MAX_LENGTH:
                return trimmed[: _LABEL_MAX_LENGTH - 1] + "…"
            return trimmed
        return f"Case {index + 1}"

    @staticmethod
    def _term_passes(term: str, output_text: str) -> bool:
        if term == "{json}":
            try:
                json.loads(output_text)
            except ValueError:
                return False
            return True
        if term.startswith("~"):
            # Time-bounded: `re` backtracks, and this pattern comes from a user.
            # See services/safe_regex.py.
            try:
                return safe_search(term[1:], output_text)
            except re.error:
                return False
        if term.startswith("!"):
            return term[1:].lower() not in output_text.lower()
        return term.lower() in output_text.lower()

    @staticmethod
    def _score_rule(criteria: str | None, output_text: str) -> tuple[float | None, str]:
        if not criteria or not criteria.strip():
            return None, "No criteria configured."

        required = [term for term in (part.strip() for part in _split_criteria(criteria)) if term]
        if not required:
            return None, "No criteria configured."

        hits = []
        misses = []
        for term in required:
            try:
                passed = EvalService._term_passes(term, output_text)
            except UnsafePatternError as exc:
                # A rule that cannot be evaluated is not a rule that failed:
                # report it rather than scoring it as a legitimate miss.
                return None, f"Could not evaluate '{term}': {exc}"
            (hits if passed else misses).append(term)

        score = round(len(hits) / len(required) * 100, 1)

        parts = []
        if hits:
            parts.append(f"Passed: {', '.join(hits)}")
        if misses:
            parts.append(f"Failed: {', '.join(misses)}")
        return score, "; ".join(parts)

    @staticmethod
    def _score_judge(
        criteria: str | None,
        output_text: str,
        compiled_prompt: str,
        connection: LLMConnection,
    ) -> JudgeResult:
        """Grade one output with the user's own model. Judge grading uses the
        same connection as the case run itself: with bring-your-own providers
        there is no operator-pinned judge model to fall back on, and reusing
        the connection keeps the judge call's cost/latency comparable to the
        run it is grading."""
        rubric = criteria.strip() if criteria and criteria.strip() else "Overall quality"
        start = time.monotonic()
        user_content = (
            f"Rubric: {rubric}\n\n"
            f"Prompt the model was given:\n"
            f"{_truncate(compiled_prompt, _JUDGE_PROMPT_MAX_CHARS)}\n\n"
            f"Output to grade:\n{_truncate(output_text, _JUDGE_OUTPUT_MAX_CHARS)}"
        )
        try:
            raw, usage = json_completion(
                connection,
                system_prompt=_JUDGE_SYSTEM_PROMPT,
                user_content=user_content,
                schema=_JUDGE_RESPONSE_SCHEMA,
            )
        except LLMResponseFormatError as exc:
            raise JudgeError(str(exc)) from exc
        latency_ms = int((time.monotonic() - start) * 1000)

        try:
            score = max(0, min(100, int(raw["score"])))
            rationale_json = json.dumps(
                {
                    "text": raw["rationale"],
                    "strengths": raw.get("strengths", []),
                    "weaknesses": raw.get("weaknesses", []),
                }
            )
        except (KeyError, TypeError, ValueError) as exc:
            msg = f"Unparseable judge response: {exc}"
            raise JudgeError(msg) from exc

        cost_usd = cost_usd_for(
            usage.provider, usage.model, usage.prompt_tokens, usage.completion_tokens
        )

        return JudgeResult(
            score=float(score),
            rationale=rationale_json,
            provider=usage.provider,
            model=usage.model,
            latency_ms=latency_ms,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            cost_usd=round(cost_usd, 6),
        )

    @staticmethod
    def _execute_case(
        compiled: str, connection: LLMConnection, method: str, criteria: str | None
    ) -> _CaseOutcome:
        """Run one case's provider-facing work (model run, then judge grading
        if the method needs it). Pure worker: no session, no ORM — safe to run
        on an executor thread."""
        try:
            result = PlaygroundService.run(compiled, connection)
        except PlaygroundRunError as exc:
            return _CaseOutcome(run_error=str(exc))

        if method != "judge":
            return _CaseOutcome(result=result)

        try:
            judge_result = EvalService._score_judge(
                criteria, result.output_text, compiled, connection
            )
        except (OpenAIError, JudgeError) as exc:
            return _CaseOutcome(result=result, judge_error=str(exc))
        return _CaseOutcome(result=result, judge_result=judge_result)

    @staticmethod
    def run_evaluation(
        db: Session, prompt: Prompt, user: User, max_workers: int = _DEFAULT_MAX_WORKERS
    ) -> EvalRun:
        """
        Compile and run every eval case attached to `prompt` against a real
        model (up to `max_workers` cases concurrently), score each by its
        method, and persist the run + results.

        Raises:
            BudgetExceededError: If a global/per-user spend ceiling is already
                reached before dispatch — aborts the whole run, since nothing
                has been committed yet.
            LLMConnectionError: If the user has no usable provider connection —
                also aborts before anything is committed.

        Case failures (model run errors, judge API errors, unparseable judge
        responses, or a case exceeding the per-case timeout) are captured
        per-case instead of aborting the run.
        """
        # Resolved once and shared: the SDK client is thread-safe, and a
        # per-worker client would open a fresh connection pool per case.
        connection = client_for(user)
        model = connection.model
        case_timeout = _case_timeout_seconds(connection)
        cases = (
            db.query(EvalCase)
            .filter(EvalCase.prompt_id == prompt.id)
            .order_by(EvalCase.position)
            .all()
        )

        run = EvalRun(
            prompt_id=prompt.id,
            prompt_version_number=PromptVersionService.live_version_number(db, prompt.id),
            model=model,
        )
        db.add(run)
        db.flush()

        prepared = [
            (
                case,
                EvalService._label_for(case, index),
                case.variables or {},
                compile_prompt(prompt.generated_prompt, case.variables or {}),
            )
            for index, case in enumerate(cases)
        ]

        # One batch pre-check, but for the batch's estimated cost rather than
        # for "is there any headroom at all". The cases fan out concurrently and
        # none reaches the ledger until the run finishes, so a check against
        # recorded spend alone would admit a full run — up to 20 case calls plus
        # a judge call each — on the strength of a single cent of headroom.
        #
        # Judge cases spend twice (execution plus grading), so the estimate
        # assumes the worst case of every case being a judge case. Propagates
        # uncaught: nothing has been committed yet, so the attempt aborts
        # cleanly.
        BudgetService.check(
            db,
            user.id,
            estimated_cost_usd=BudgetService.estimated_batch_cost_usd(
                connection.provider_handle, connection.model, calls=len(cases) * 2
            ),
        )

        # Fan the provider-facing work out across threads; everything that
        # touches the session stays below, on this thread. Futures are
        # collected in submission order so results persist in case order.
        outcomes: list[_CaseOutcome] = []
        with ThreadPoolExecutor(max_workers=min(max_workers, max(1, len(cases)))) as pool:
            futures = [
                pool.submit(
                    EvalService._execute_case, compiled, connection, case.method, case.criteria
                )
                for case, _, _, compiled in prepared
            ]
            for future in futures:
                try:
                    outcomes.append(future.result(timeout=case_timeout))
                except TimeoutError:
                    outcomes.append(
                        _CaseOutcome(run_error=f"case timed out after {int(case_timeout)}s")
                    )

        scores: list[float] = []
        any_pending = False
        totals = _UsageTotals()

        for (case, label, variables, _), outcome in zip(prepared, outcomes, strict=True):
            if outcome.result is None:
                db.add(
                    EvalRunResult(
                        eval_run_id=run.id,
                        eval_case_id=case.id,
                        method=case.method,
                        label=label,
                        rationale=f"Model run failed: {outcome.run_error}",
                        score=None,
                        is_pending=False,
                        output_text=None,
                        criteria=case.criteria,
                        variables=variables,
                    )
                )
                continue

            result = outcome.result
            totals.add(result)
            record_billed_call(
                db,
                user.id,
                "eval_case",
                LLMUsage(
                    provider=result.provider,
                    model=result.model,
                    prompt_tokens=result.prompt_tokens,
                    completion_tokens=result.completion_tokens,
                ),
            )

            output_text = result.output_text

            if case.method == "manual":
                any_pending = True
                db.add(
                    EvalRunResult(
                        eval_run_id=run.id,
                        eval_case_id=case.id,
                        method=case.method,
                        label=label,
                        rationale=None,
                        score=None,
                        is_pending=True,
                        output_text=output_text,
                        criteria=case.criteria,
                        variables=variables,
                    )
                )
                continue

            judge_model = None
            if case.method == "judge":
                if outcome.judge_result is not None:
                    judge_result = outcome.judge_result
                    score, rationale = judge_result.score, judge_result.rationale
                    judge_model = judge_result.model
                    totals.add(judge_result)
                    record_billed_call(
                        db,
                        user.id,
                        "eval_judge",
                        LLMUsage(
                            provider=judge_result.provider,
                            model=judge_result.model,
                            prompt_tokens=judge_result.prompt_tokens,
                            completion_tokens=judge_result.completion_tokens,
                        ),
                    )
                else:
                    score, rationale = None, f"Judge grading failed: {outcome.judge_error}"
            else:
                score, rationale = EvalService._score_rule(case.criteria, output_text)

            if score is not None:
                scores.append(score)

            db.add(
                EvalRunResult(
                    eval_run_id=run.id,
                    eval_case_id=case.id,
                    method=case.method,
                    label=label,
                    rationale=rationale,
                    score=score,
                    is_pending=False,
                    output_text=output_text,
                    criteria=case.criteria,
                    variables=variables,
                    judge_model=judge_model,
                )
            )

        run.score = (
            None if any_pending else (round(sum(scores) / len(scores), 1) if scores else None)
        )
        totals.apply_to(run)

        db.commit()
        db.refresh(run)
        return run

    @staticmethod
    def submit_manual_rating(
        db: Session, result: EvalRunResult, stars: int
    ) -> tuple[EvalRun, bool]:
        """
        Record a 1-5 star manual rating for a pending result, and finalize the
        run's aggregate score if this was the last pending result.

        Returns:
            (run, just_finalized) — just_finalized is True if this call
            caused the run to have no remaining pending results.
        """
        result.score = stars * 20
        result.is_pending = False
        db.flush()

        run = result.run
        remaining_pending = any(r.is_pending for r in run.results)
        just_finalized = False
        if not remaining_pending and run.score is None:
            scores = [r.score for r in run.results if r.score is not None]
            run.score = round(sum(scores) / len(scores), 1) if scores else None
            just_finalized = True

        db.commit()
        db.refresh(run)
        return run, just_finalized
