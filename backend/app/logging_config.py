"""Stdlib JSON stdout logs with an explicit, privacy-safe field allowlist."""

from datetime import UTC, datetime
import json
import logging
import math
import re
from traceback import walk_tb

from app.metrics import (
    OPERATIONS,
    channel_context,
    classify_error,
    operation_context,
    request_id_context,
)

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_.]{0,127}\Z")
_REQUEST_ID = re.compile(r"[a-f0-9]{32}\Z")
_EVENTS = {"operation_completed", "http_request", "unhandled_exception", "request_validation"}
_DIAGNOSTIC_EVENTS = {
    ("app.metrics", "snapshot_collection_failed"): "snapshot_collection_failed",
    (
        "app.services.accounts.connections",
        "llm_connection_test_failed",
    ): "llm_connection_test_failed",
    (
        "app.services.accounts.passwords",
        "password_reset_email_failed",
    ): "password_reset_email_failed",
    (
        "app.services.accounts.connections",
        "LLM connection test failed for user %s: %s",
    ): "llm_connection_test_failed",
    ("app.api.deps", "LLM error in %s: %s"): "llm_request_failed",
    (
        "app.services.accounts.connections",
        "Stored LLM key for user %s is undecryptable",
    ): "llm_key_unreadable",
    (
        "app.services.llm_client",
        "Provider %s rejected response_format; retrying prompt-only: %s",
    ): "llm_json_fallback",
    (
        "app.services.llm_client",
        "Provider %s returned unparseable JSON (degraded=%s); retrying",
    ): "llm_json_retry",
}
_ERROR_TYPES = {
    "none",
    "validation",
    "authentication",
    "permission",
    "conflict",
    "not_found",
    "budget",
    "provider",
    "timeout",
    "internal",
}


def _identifier(value: object) -> str | None:
    return value if isinstance(value, str) and _IDENTIFIER.fullmatch(value) else None


def _safe_stack(traceback) -> list[dict]:
    frames = [
        {
            "module": _identifier(frame.f_globals.get("__name__")) or "unknown",
            "function": _identifier(frame.f_code.co_name) or "unknown",
            "line": line,
        }
        for frame, line in walk_tb(traceback)
    ]
    return frames[-16:]


class JsonFormatter(logging.Formatter):
    """Never format free-text messages, arguments, arbitrary extras or tracebacks."""

    def format(self, record: logging.LogRecord) -> str:
        context = operation_context.get()
        structured = record.name in {"app.operation", "app.http"}
        event = getattr(record, "event", None) if structured else None
        if not structured and isinstance(record.msg, str):
            event = _DIAGNOSTIC_EVENTS.get((record.name, record.msg))
        request_id = request_id_context.get()
        operation = getattr(context, "operation", None)
        error_type = getattr(context, "error_type", "none")
        channel = channel_context.get()
        outcome = getattr(context, "outcome", None)
        duration = None
        if structured:
            request_id = getattr(record, "request_id", request_id)
            operation = getattr(record, "operation", operation)
            error_type = getattr(record, "error_type", error_type)
            channel = getattr(record, "channel", channel)
            outcome = getattr(record, "outcome", outcome)
            duration = getattr(record, "duration_seconds", None)
        if not isinstance(duration, (int, float)) or not math.isfinite(duration):
            duration = None
        result = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": logging.getLevelName(record.levelno),
            "logger": _identifier(record.name) or "unknown",
            "event": event
            if event in _EVENTS or event in _DIAGNOSTIC_EVENTS.values()
            else ("exception" if record.exc_info else "log"),
            "request_id": request_id
            if isinstance(request_id, str) and _REQUEST_ID.fullmatch(request_id)
            else None,
            "operation": operation if operation in OPERATIONS else None,
            "channel": channel,
            "outcome": outcome,
            "duration_seconds": duration,
            "error_type": error_type if error_type in _ERROR_TYPES else "internal",
        }
        if result["channel"] not in {"rest", "mcp"}:
            result["channel"] = "rest"
        if result["outcome"] not in {"success", "rejected", "error", "partial"}:
            result["outcome"] = None
        if record.exc_info and record.exc_info[0]:
            result["exception_type"] = _identifier(record.exc_info[0].__name__) or "Exception"
            if result["error_type"] == "none":
                result["error_type"] = classify_error(record.exc_info[1])[1]
            result["stack"] = _safe_stack(record.exc_info[2])
        if not structured:
            result["source"] = f"{_identifier(record.module) or 'unknown'}:{record.lineno}"
        if structured and event == "http_request":
            result.update(
                {
                    "method": getattr(record, "method", "OTHER"),
                    "route": getattr(record, "route", None),
                    "status_code": getattr(record, "status_code", None),
                }
            )
        if structured and event == "request_validation":
            result["validation_error_types"] = [
                safe
                for value in getattr(record, "validation_error_types", [])
                if (safe := _identifier(value)) is not None
            ]
            result["validation_error_count"] = getattr(record, "validation_error_count", 0)
        return json.dumps(result, ensure_ascii=True, allow_nan=False)


LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "app.logging_config.JsonFormatter"}},
    "handlers": {
        "stdout": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "stream": "ext://sys.stdout",
        },
    },
    "root": {"level": "INFO", "handlers": ["stdout"]},
    "loggers": {
        "uvicorn": {"level": "INFO", "handlers": [], "propagate": True},
        "uvicorn.error": {"level": "INFO", "handlers": [], "propagate": True},
        "uvicorn.access": {"level": "INFO", "handlers": [], "propagate": True},
    },
}
