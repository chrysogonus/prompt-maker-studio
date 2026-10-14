"""Safe structured logs and HTTP request context."""

import asyncio
from datetime import datetime
import importlib.util
import json
import logging
from pathlib import Path
import runpy
import subprocess
import sys

import pytest


def format_record(record):
    assert importlib.util.find_spec("app.logging_config") is not None
    from app.logging_config import JsonFormatter

    return JsonFormatter().format(record)


def test_legacy_log_omits_sensitive_message_exception_and_extra_fields():
    secret = "password=hunter2 email=person@example.com key=sk-secret 192.168.0.1 ?token=secret"
    try:
        raise RuntimeError(secret)
    except RuntimeError:
        record = logging.LogRecord(
            "app.services.llm_client", logging.ERROR, __file__, 1, secret, (), sys.exc_info()
        )
    record.body = secret
    serialized = format_record(record)
    event = json.loads(serialized)
    assert event["logger"] == "app.services.llm_client"
    assert event["error_type"] == "internal"
    assert event["exception_type"] == "RuntimeError"
    assert (
        event["stack"][-1]["function"]
        == "test_legacy_log_omits_sensitive_message_exception_and_extra_fields"
    )
    assert event["stack"][-1]["module"].endswith("test_logging")
    assert isinstance(event["stack"][-1]["line"], int)
    assert event["event"] == "exception"
    assert "test_logging" in event["source"]
    for sensitive in (
        "hunter2",
        "person@example.com",
        "sk-secret",
        "192.168.0.1",
        "?token",
        "body",
        "Traceback",
    ):
        assert sensitive not in serialized


@pytest.mark.parametrize(
    ("name", "template", "event"),
    [
        ("app.metrics", "snapshot_collection_failed", "snapshot_collection_failed"),
        (
            "app.services.accounts.passwords",
            "password_reset_email_failed",
            "password_reset_email_failed",
        ),
        (
            "app.services.accounts.connections",
            "llm_connection_test_failed",
            "llm_connection_test_failed",
        ),
        ("app.api.deps", "LLM error in %s: %s", "llm_request_failed"),
        (
            "app.services.accounts.connections",
            "Stored LLM key for user %s is undecryptable",
            "llm_key_unreadable",
        ),
        (
            "app.services.llm_client",
            "Provider %s rejected response_format; retrying prompt-only: %s",
            "llm_json_fallback",
        ),
        (
            "app.services.llm_client",
            "Provider %s returned unparseable JSON (degraded=%s); retrying",
            "llm_json_retry",
        ),
    ],
)
def test_known_diagnostics_have_fixed_event_without_formatting_arguments(name, template, event):
    secret = "hunter2 person@example.com sk-secret 192.168.0.1 ?token=secret"
    record = logging.LogRecord(name, logging.ERROR, __file__, 1, template, (secret, secret), None)
    serialized = format_record(record)
    assert json.loads(serialized)["event"] == event
    for sensitive in ("hunter2", "person@example.com", "sk-secret", "192.168.0.1", "?token"):
        assert sensitive not in serialized


@pytest.mark.parametrize(
    ("template", "expected"),
    [
        ("Applying database migration %s", "migration_applying"),
        ("Applied database migration %s", "migration_applied"),
    ],
)
def test_migration_progress_keeps_numeric_version_without_raw_arguments(template, expected):
    record = logging.LogRecord(
        "app.database.migrations.runner",
        logging.INFO,
        __file__,
        1,
        template,
        ("password=hunter2",),
        None,
    )
    record.migration_version = "020_delete_cascades"
    event = json.loads(format_record(record))
    assert event["event"] == expected
    assert event["migration_version"] == "020_delete_cascades"
    assert "hunter2" not in json.dumps(event)


@pytest.mark.parametrize("version", ["020_person@example.com", "020_key=secret", None, 20])
def test_migration_version_rejects_sensitive_or_malformed_fields(version):
    record = logging.LogRecord(
        "app.database.migrations.runner",
        logging.INFO,
        __file__,
        1,
        "Applied database migration %s",
        ("private",),
        None,
    )
    record.migration_version = version
    event = json.loads(format_record(record))
    assert event["event"] == "migration_applied"
    assert event["migration_version"] is None


def test_actual_runner_emits_versions_and_is_quiet_on_restart(db_session, monkeypatch, caplog):
    from app.database.migrations import runner

    monkeypatch.setattr(runner, "_MIGRATIONS", (("026_logging_probe", lambda _connection: None),))
    with caplog.at_level(logging.INFO, logger="app.database.migrations.runner"):
        runner.run_migrations(db_session.get_bind())
        runner.run_migrations(db_session.get_bind())
    events = [
        json.loads(format_record(record))
        for record in caplog.records
        if record.name == "app.database.migrations.runner"
    ]
    assert [event["event"] for event in events] == ["migration_applying", "migration_applied"]
    assert [event["migration_version"] for event in events] == ["026_logging_probe"] * 2


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Started server process [%d]", "server_started"),
        ("Finished server process [%d]", "server_stopped"),
        ("Waiting for application startup.", "startup_started"),
        ("Application startup complete.", "startup_complete"),
        ("Application startup failed. Exiting.", "startup_failed"),
        ("Application shutdown complete.", "shutdown_complete"),
        ("Application shutdown failed. Exiting.", "shutdown_failed"),
        ('Error loading ASGI app. Could not import module "private-module".', "asgi_load_failed"),
        ("Error loading ASGI app factory: password=hunter2", "asgi_factory_failed"),
    ],
)
def test_uvicorn_lifecycle_and_loading_failures_keep_safe_event(message, expected):
    record = logging.LogRecord("uvicorn.error", logging.ERROR, __file__, 1, message, (), None)
    serialized = format_record(record)
    assert json.loads(serialized)["event"] == expected
    assert "hunter2" not in serialized
    assert "private-module" not in serialized


def test_uvicorn_error_prefix_is_not_trusted_from_other_loggers():
    record = logging.LogRecord(
        "app.services.llm_client",
        logging.ERROR,
        __file__,
        1,
        "Error loading ASGI app. password=hunter2",
        (),
        None,
    )
    assert json.loads(format_record(record))["event"] == "log"


def test_operation_log_has_context_and_explicit_safe_fields():
    from app.metrics import channel_context, operation_context, request_id_context

    request_token = request_id_context.set("a" * 32)
    channel_token = channel_context.set("mcp")
    try:
        record = logging.LogRecord(
            "app.operation", logging.INFO, __file__, 1, "sensitive prompt", (), None
        )
        record.event = "operation_completed"
        record.operation = "prompt_create"
        record.outcome = "success"
        record.duration_seconds = 0.125
        record.error_type = "none"
        event = json.loads(format_record(record))
    finally:
        request_id_context.reset(request_token)
        channel_context.reset(channel_token)
    assert datetime.fromisoformat(event["timestamp"]).utcoffset().total_seconds() == 0
    assert event["level"] == "INFO"
    assert event["event"] == "operation_completed"
    assert event["request_id"] == "a" * 32
    assert event["channel"] == "mcp"
    assert event["operation"] == "prompt_create"
    assert event["outcome"] == "success"
    assert event["duration_seconds"] == 0.125
    assert operation_context.get() is None


def test_runner_configures_json_stdout_without_unsafe_uvicorn_access(monkeypatch):
    invocation = {}
    monkeypatch.setattr("uvicorn.run", lambda *_args, **kwargs: invocation.update(kwargs))
    runpy.run_path(str(Path(__file__).parents[1] / "run.py"), run_name="__main__")
    assert invocation["access_log"] is False
    config = invocation["log_config"]
    assert config["disable_existing_loggers"] is False
    assert config["root"]["level"] == "INFO"
    assert config["handlers"]["stdout"]["stream"] == "ext://sys.stdout"


def test_logging_config_emits_safe_application_info_to_stdout():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import logging, logging.config; from app.logging_config import LOGGING_CONFIG; logging.config.dictConfig(LOGGING_CONFIG); logging.getLogger('app.services.accounts.passwords').info('email=person@example.com password=hunter2')",
        ],
        cwd=Path(__file__).parents[1],
        check=True,
        capture_output=True,
        text=True,
    )
    event = json.loads(result.stdout)
    assert event["level"] == "INFO"
    assert event["logger"] == "app.services.accounts.passwords"
    assert event["event"] == "log"
    assert "person@example.com" not in result.stdout
    assert "hunter2" not in result.stdout
    assert result.stderr == ""


def test_unhandled_http_error_keeps_correlation_after_context_reset(caplog):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.http import configure_http
    from app.metrics import request_id_context

    isolated = FastAPI()
    configure_http(isolated)

    @isolated.get("/broken/{item_id}")
    def broken(item_id: str):
        message = f"password=hunter2 email=person@example.com item={item_id}"
        raise RuntimeError(message)

    with (
        caplog.at_level(logging.INFO, logger="app.http"),
        TestClient(isolated, raise_server_exceptions=False) as client,
    ):
        response = client.get("/broken/secret?token=secret")
    assert response.status_code == 500
    assert request_id_context.get() is None
    events = [json.loads(format_record(r)) for r in caplog.records if r.name == "app.http"]
    assert {event["event"] for event in events} == {"http_request", "unhandled_exception"}
    assert all(event["request_id"] == response.headers["x-request-id"] for event in events)
    http_event = next(event for event in events if event["event"] == "http_request")
    assert http_event["route"] == "/broken/{item_id}"
    assert http_event["status_code"] == 500
    exception_event = next(event for event in events if event["event"] == "unhandled_exception")
    assert exception_event["exception_type"] == "RuntimeError"
    for sensitive in ("hunter2", "person@example.com", "token=secret", "/broken/secret"):
        assert sensitive not in json.dumps(events)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "channel", "raises"), [("/api/prompts/12", "rest", False), ("/api/mcp", "mcp", True)]
)
async def test_request_context_is_correlated_and_reset(path, channel, raises, caplog):
    from app.http import RequestIdMiddleware
    from app.metrics import channel_context, request_id_context

    seen = []
    sent = []

    async def endpoint(scope, receive, send):
        seen.append((request_id_context.get(), channel_context.get()))
        if raises:
            message = "password=hunter2"
            raise RuntimeError(message)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "path": path,
        "method": "GET",
        "query_string": b"password=hunter2",
        "client": ("192.168.0.1", 42),
    }
    with caplog.at_level(logging.INFO, logger="app.http"):
        if raises:
            with pytest.raises(RuntimeError):
                await RequestIdMiddleware(endpoint)(scope, receive, send)
        else:
            await RequestIdMiddleware(endpoint)(scope, receive, send)
    assert seen == [(scope["state"]["request_id"], channel)]
    assert request_id_context.get() is None
    assert channel_context.get() == "rest"
    records = [r for r in caplog.records if getattr(r, "event", None) == "http_request"]
    assert len(records) == 1
    event = json.loads(format_record(records[0]))
    assert event["request_id"] == scope["state"]["request_id"]
    assert event["channel"] == channel
    assert event["status_code"] == (500 if raises else 200)
    assert event["route"] is None
    assert event["duration_seconds"] >= 0
    assert "hunter2" not in json.dumps(event)
    assert "192.168.0.1" not in json.dumps(event)


def test_http_log_uses_route_template_and_preserves_validation_summary(client, caplog):
    with caplog.at_level(logging.INFO, logger="app.http"):
        response = client.post(
            "/api/auth/register?token=secret",
            json={"username": "person", "password": "hunter2", "email": "person@example.com"},
        )
    events = [json.loads(format_record(r)) for r in caplog.records if r.name == "app.http"]
    traffic = [event for event in events if event["event"] == "http_request"]
    assert len(traffic) == 1
    assert traffic[0]["route"] == "/api/auth/register"
    assert traffic[0]["status_code"] == 422
    assert traffic[0]["request_id"] == response.headers["x-request-id"]
    validation = next(event for event in events if event["event"] == "request_validation")
    assert "string_too_short" in validation["validation_error_types"]
    for sensitive in ("hunter2", "person@example.com", "token=secret"):
        assert sensitive not in json.dumps(events)


def test_automatic_requests_do_not_emit_http_logs(client, caplog):
    with caplog.at_level(logging.INFO, logger="app.http"):
        client.get("/")
        response = client.get("/metrics", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers["Content-Encoding"] == "gzip"
    assert response.headers["Content-Type"].startswith("text/plain")
    assert "http_requests_total" in response.text
    assert not [r for r in caplog.records if getattr(r, "event", None) == "http_request"]


@pytest.mark.asyncio
async def test_concurrent_requests_keep_independent_context():
    from app.http import RequestIdMiddleware
    from app.metrics import channel_context, request_id_context

    contexts = []
    reached = asyncio.Event()

    async def endpoint(scope, receive, send):
        before = (request_id_context.get(), channel_context.get())
        contexts.append(before)
        if len(contexts) == 2:
            reached.set()
        await reached.wait()
        assert before == (request_id_context.get(), channel_context.get())
        await send({"type": "http.response.start", "status": 200, "headers": []})

    async def receive():
        return {"type": "http.request"}

    async def send(message):
        pass

    middleware = RequestIdMiddleware(endpoint)
    await asyncio.gather(
        *(
            middleware({"type": "http", "path": path, "method": "GET"}, receive, send)
            for path in ("/api/mcp", "/api/prompts")
        )
    )
    assert contexts[0][0] != contexts[1][0]
    assert {context[1] for context in contexts} == {"rest", "mcp"}
    assert request_id_context.get() is None
