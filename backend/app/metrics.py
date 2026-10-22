"""Bounded operation telemetry, provider attempts and current database totals."""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
from http import HTTPStatus
import logging
import math
from threading import Lock
import time

from openai import APITimeoutError, OpenAIError
from prometheus_client import Counter, Gauge, Histogram
from sqlalchemy import func

from app.models.eval_run_result import EvalRunResult
from app.models.prompt import Prompt
from app.models.user import User
from app.services.llm_pricing import cost_usd_for
from app.services.llm_providers import PROVIDERS

logger = logging.getLogger("app.operation")

OPERATIONS = (
    "signup",
    "login",
    "account_delete",
    "password_reset",
    "password_reset_email",
    "prompt_create",
    "prompt_update",
    "prompt_duplicate",
    "prompt_delete",
    "prompt_restore",
    "ai_import",
    "refine_questions",
    "refine_draft",
    "public_refine_questions",
    "public_refine_draft",
    "try_once",
    "eval_generate",
    "eval_run",
    "connection_test",
)
OUTCOMES = ("success", "rejected", "error", "partial")
CHANNELS = ("rest", "mcp")
AI_FEATURES = (
    "ai_import",
    "refine_questions",
    "refine_draft",
    "public_refine_questions",
    "public_refine_draft",
    "try_once",
    "eval_generate",
    "eval_run",
    "connection_test",
    "other",
)
DURATION_BUCKETS = (0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600)
SNAPSHOT_INTERVAL_SECONDS = 30

operations_total = Counter(
    "pms_operations_total", "Finished application operations.", ["operation", "outcome", "channel"]
)
operation_duration = Histogram(
    "pms_operation_duration_seconds",
    "Application operation duration.",
    ["operation"],
    buckets=DURATION_BUCKETS,
)
operations_in_progress = Gauge(
    "pms_operations_in_progress", "Application operations currently running.", ["operation"]
)
eval_cases_total = Counter(
    "pms_eval_cases_total", "Committed evaluation case outcomes.", ["method", "outcome"]
)
llm_calls_total = Counter(
    "pms_llm_calls_total",
    "Explicit SDK calls; SDK-internal retries are not separately counted.",
    ["feature", "provider", "outcome"],
)
llm_duration = Histogram(
    "pms_llm_duration_seconds",
    "Explicit SDK call duration including internal retries.",
    ["feature", "provider"],
    buckets=DURATION_BUCKETS,
)
llm_tokens_total = Counter(
    "pms_llm_tokens_total",
    "Tokens reported by returned provider responses.",
    ["feature", "provider", "direction"],
)
llm_estimated_cost_total = Counter(
    "pms_llm_estimated_cost_usd_total",
    "Estimated cost of reported usage, not an invoice.",
    ["feature", "provider"],
)
llm_cost_estimation_errors_total = Counter(
    "pms_llm_cost_estimation_errors_total", "Returned usage whose cost could not be estimated."
)
llm_usage_collection_errors_total = Counter(
    "pms_llm_usage_collection_errors_total", "Provider responses with unusable token usage."
)
accounts_current = Gauge("pms_accounts_current", "Current accounts from the database snapshot.")
prompts_current = Gauge("pms_prompts_current", "Current prompts from the database snapshot.")
pending_ratings_current = Gauge(
    "pms_eval_pending_ratings_current", "Current evaluation results awaiting manual ratings."
)
snapshot_last_success = Gauge(
    "pms_snapshot_last_success_timestamp_seconds", "Unix time of the last successful snapshot."
)
snapshot_collection_errors_total = Counter(
    "pms_snapshot_collection_errors_total", "Failed database snapshot collections."
)

for name in OPERATIONS:
    operation_duration.labels(name)
    operations_in_progress.labels(name)
    for outcome in OUTCOMES:
        for channel in CHANNELS:
            operations_total.labels(name, outcome, channel)
for method in ("rule", "judge", "manual"):
    for outcome in ("scored", "pending_manual", "execution_error", "judge_error"):
        eval_cases_total.labels(method, outcome)
for feature in AI_FEATURES:
    for provider in PROVIDERS:
        for outcome in ("success", "error"):
            llm_calls_total.labels(feature, provider, outcome)
        for direction in ("input", "output"):
            llm_tokens_total.labels(feature, provider, direction)
        llm_estimated_cost_total.labels(feature, provider)
        llm_duration.labels(feature, provider)
for gauge in (accounts_current, prompts_current, pending_ratings_current):
    gauge.set(math.nan)


@dataclass
class OperationState:
    operation: str
    outcome: str = "success"
    error_type: str = "none"


request_id_context = ContextVar("request_id", default=None)
channel_context = ContextVar("channel", default="rest")
operation_context: ContextVar[OperationState | None] = ContextVar("operation", default=None)


def classify_error(exc: Exception) -> tuple[str, str]:
    """Classify typed failures without serializing private exception messages."""
    # Imported at classification time: both service modules depend on metrics.
    from app.services.budget_service import BudgetExceededError  # noqa: PLC0415
    from app.services.llm_client import LLMConnectionError, LLMResponseFormatError  # noqa: PLC0415

    cause = exc
    while cause is not None:
        if isinstance(cause, APITimeoutError):
            return "error", "timeout"
        if isinstance(cause, OpenAIError | LLMResponseFormatError):
            return "error", "provider"
        if isinstance(cause, BudgetExceededError):
            return "rejected", "budget"
        cause = cause.__cause__
    status = getattr(exc, "status_code", None)
    if status is not None and HTTPStatus.BAD_REQUEST <= status < HTTPStatus.INTERNAL_SERVER_ERROR:
        return "rejected", {
            401: "authentication",
            403: "permission",
            404: "not_found",
            409: "conflict",
            402: "budget",
        }.get(status, "validation")
    if isinstance(exc, LLMConnectionError):
        return "rejected", "validation"
    return "error", "internal"


@contextmanager
def operation(name: str):
    if name not in OPERATIONS:
        msg = "Unknown telemetry operation"
        raise ValueError(msg)
    channel = channel_context.get()
    state = OperationState(name)
    token = operation_context.set(state)
    started = time.monotonic()
    operations_in_progress.labels(name).inc()
    try:
        yield state
    except Exception as exc:
        state.outcome, state.error_type = classify_error(exc)
        raise
    finally:
        elapsed = time.monotonic() - started
        operations_in_progress.labels(name).dec()
        operation_duration.labels(name).observe(elapsed)
        operations_total.labels(name, state.outcome, channel).inc()
        logger.info(
            "operation_completed",
            extra={
                "event": "operation_completed",
                "operation": name,
                "channel": channel,
                "outcome": state.outcome,
                "duration_seconds": elapsed,
                "error_type": state.error_type,
                "request_id": request_id_context.get(),
            },
        )
        operation_context.reset(token)


def observe_operation(name: str):
    """Wrap a synchronous service/orchestration boundary exactly once."""

    def decorate(function):
        @wraps(function)
        def observed(*args, **kwargs):
            with operation(name):
                return function(*args, **kwargs)

        return observed

    return decorate


@dataclass
class ProviderAttempt:
    usage: object | None = None


@contextmanager
def provider_attempt(connection):
    state = operation_context.get()
    feature = state.operation if state and state.operation in AI_FEATURES else "other"
    provider = connection.provider_handle
    attempt = ProviderAttempt()
    started = time.monotonic()
    outcome = "success"
    try:
        yield attempt
    except Exception:
        outcome = "error"
        raise
    finally:
        llm_calls_total.labels(feature, provider, outcome).inc()
        llm_duration.labels(feature, provider).observe(time.monotonic() - started)
        if attempt.usage is not None:
            _record_provider_usage(feature, provider, attempt.usage)


def _record_provider_usage(feature: str, provider: str, usage) -> None:
    # Compatible endpoints can return malformed usage. Preserve the original
    # response while rejecting values that would poison or break telemetry.
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value < 0
        for value in (usage.prompt_tokens, usage.completion_tokens)
    ):
        llm_usage_collection_errors_total.inc()
        return
    llm_tokens_total.labels(feature, provider, "input").inc(usage.prompt_tokens)
    llm_tokens_total.labels(feature, provider, "output").inc(usage.completion_tokens)
    try:
        cost = cost_usd_for(
            provider, usage.model, usage.prompt_tokens, usage.completion_tokens, refresh=False
        )
        if not isinstance(cost, int | float) or not math.isfinite(cost) or cost < 0:
            msg = "Unusable telemetry cost estimate"
            raise ValueError(msg)
    except Exception:
        llm_cost_estimation_errors_total.inc()
    else:
        llm_estimated_cost_total.labels(feature, provider).inc(cost)


_snapshot_lock = Lock()
_snapshot_last_attempt = 0.0


def refresh_snapshot(db, *, force: bool = False) -> None:
    """Cache aggregate reads; never report a failed collection as zero users."""
    global _snapshot_last_attempt  # noqa: PLW0603 — one process-wide, lock-protected cache

    with _snapshot_lock:
        now = time.monotonic()
        if not force and now - _snapshot_last_attempt < SNAPSHOT_INTERVAL_SECONDS:
            return
        _snapshot_last_attempt = now
        try:
            accounts = db.query(func.count(User.id)).scalar()
            prompts = db.query(func.count(Prompt.id)).scalar()
            pending = (
                db.query(func.count(EvalRunResult.id))
                .filter(EvalRunResult.is_pending.is_(True))
                .scalar()
            )
        except Exception:
            snapshot_collection_errors_total.inc()
            logging.getLogger("app.metrics").warning(
                "snapshot_collection_failed", extra={"event": "snapshot_collection_failed"}
            )
            return
        accounts_current.set(accounts)
        prompts_current.set(prompts)
        pending_ratings_current.set(pending)
        snapshot_last_success.set(time.time())
