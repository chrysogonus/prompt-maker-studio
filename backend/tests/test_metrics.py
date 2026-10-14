"""Telemetry boundaries, snapshots and provider-attempt regressions."""

import logging
from unittest.mock import Mock, patch

from openai import OpenAIError
import pytest

from app import metrics
from app.services.errors import OperationError
from app.services.llm_client import LLMResponseFormatError, json_completion, text_completion
from tests.conftest import make_chat_response, make_connection


def sample(metric, suffix="_total", **labels):
    return next(
        item.value
        for family in metric.collect()
        for item in family.samples
        if item.name.endswith(suffix) and all(item.labels.get(k) == v for k, v in labels.items())
    )


def test_operation_failure_and_context_cleanup(caplog):
    labels = {"operation": "prompt_create", "outcome": "error", "channel": "rest"}
    before = sample(metrics.operations_total, **labels)

    def fail():
        with metrics.operation("prompt_create"):
            assert metrics.operation_context.get().operation == "prompt_create"
            msg = "secret payload"
            raise RuntimeError(msg)

    with (
        caplog.at_level(logging.INFO, logger="app.operation"),
        pytest.raises(RuntimeError, match="secret payload"),
    ):
        fail()
    assert metrics.operation_context.get() is None
    assert sample(metrics.operations_total, **labels) == before + 1
    assert sample(metrics.operations_in_progress, "in_progress", operation="prompt_create") == 0
    assert caplog.records[-1].error_type == "internal"
    assert "secret payload" not in caplog.records[-1].getMessage()


def test_rejected_operation_and_mcp_channel():
    labels = {"operation": "prompt_update", "outcome": "rejected", "channel": "mcp"}
    token = metrics.channel_context.set("mcp")
    before = sample(metrics.operations_total, **labels)
    try:
        with pytest.raises(OperationError), metrics.operation("prompt_update"):
            raise OperationError(409, "private prompt name")
    finally:
        metrics.channel_context.reset(token)
    assert sample(metrics.operations_total, **labels) == before + 1


def test_snapshot_queries_isolated_db_and_keeps_values_on_failure(db_session):
    metrics.refresh_snapshot(db_session, force=True)
    assert sample(metrics.accounts_current, "current") == 0
    assert sample(metrics.prompts_current, "current") == 0
    last_success = sample(metrics.snapshot_last_success, "seconds")
    before = sample(metrics.snapshot_collection_errors_total)
    with patch.object(db_session, "query", side_effect=RuntimeError("secret db url")):
        metrics.refresh_snapshot(db_session, force=True)
    assert sample(metrics.accounts_current, "current") == 0
    assert sample(metrics.snapshot_last_success, "seconds") == last_success
    assert sample(metrics.snapshot_collection_errors_total) == before + 1


def test_snapshot_cache_does_not_query_again(db_session):
    metrics.refresh_snapshot(db_session, force=True)
    with patch.object(db_session, "query") as query:
        metrics.refresh_snapshot(db_session)
    query.assert_not_called()


def test_current_snapshots_follow_account_deletion(client, auth_headers, monkeypatch):
    response = client.post(
        "/api/prompts",
        headers=auth_headers,
        json={"name": "Snapshot", "fields": [{"name": "task", "content": "Hello"}]},
    )
    assert response.status_code == 201
    monkeypatch.setattr(metrics, "_snapshot_last_attempt", 0)
    assert client.get("/metrics").status_code == 200
    assert sample(metrics.accounts_current, "current") == 1
    assert sample(metrics.prompts_current, "current") == 1
    response = client.request(
        "DELETE", "/api/auth/me", headers=auth_headers, json={"current_password": "testpass123"}
    )
    assert response.status_code == 204
    monkeypatch.setattr(metrics, "_snapshot_last_attempt", 0)
    assert client.get("/metrics").status_code == 200
    assert sample(metrics.accounts_current, "current") == 0
    assert sample(metrics.prompts_current, "current") == 0


def test_actual_mcp_save_counts_once_without_rest_event(client, auth_headers, test_db, monkeypatch):
    monkeypatch.setattr("app.api.mcp_routes.SessionLocal", test_db)
    mcp = {"operation": "prompt_create", "outcome": "success", "channel": "mcp"}
    rest = {**mcp, "channel": "rest"}
    before_mcp = sample(metrics.operations_total, **mcp)
    before_rest = sample(metrics.operations_total, **rest)
    response = client.post(
        "/api/mcp",
        headers={**auth_headers, "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "save_prompt",
                "arguments": {
                    "name": "MCP snapshot",
                    "fields": [{"name": "task", "content": "Hello"}],
                },
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["isError"] is False
    assert sample(metrics.operations_total, **mcp) == before_mcp + 1
    assert sample(metrics.operations_total, **rest) == before_rest


def test_cost_estimation_failure_does_not_change_completion():
    connection = make_connection(Mock(return_value=make_chat_response("hello", 13, 7)))
    before = sample(metrics.llm_cost_estimation_errors_total)
    with patch("app.metrics.cost_usd_for", side_effect=RuntimeError("private details")):
        output, usage = text_completion(connection, [{"role": "user", "content": "private"}])
    assert output == "hello"
    assert usage.prompt_tokens == 13
    assert sample(metrics.llm_cost_estimation_errors_total) == before + 1


def test_telemetry_cost_never_refreshes_pricing_over_network():
    connection = make_connection(Mock(return_value=make_chat_response("hello", 13, 7)))
    with patch("app.services.llm_pricing._fetch_pricing_json") as fetch:
        output, _ = text_completion(connection, [{"role": "user", "content": "private"}])
    assert output == "hello"
    fetch.assert_not_called()


@pytest.mark.parametrize("input_tokens", [-1, float("nan"), "13"])
def test_malformed_usage_does_not_replace_completed_response(input_tokens):
    connection = make_connection(Mock(return_value=make_chat_response("hello", input_tokens, 7)))
    before = sample(metrics.llm_usage_collection_errors_total)
    output, usage = text_completion(connection, [{"role": "user", "content": "private"}])
    assert output == "hello"
    assert usage.completion_tokens == 7
    assert sample(metrics.llm_usage_collection_errors_total) == before + 1


def test_provider_usage_survives_invalid_json_and_counts_explicit_attempts():
    connection = make_connection(Mock(return_value=make_chat_response("not JSON", 13, 7)))
    labels = {"feature": "ai_import", "provider": "openai", "outcome": "success"}
    before = sample(metrics.llm_calls_total, **labels)
    token_labels = {"feature": "ai_import", "provider": "openai", "direction": "input"}
    tokens = sample(metrics.llm_tokens_total, **token_labels)
    with metrics.operation("ai_import"), pytest.raises(LLMResponseFormatError):
        json_completion(connection, system_prompt="system", user_content="private", schema={})
    assert sample(metrics.llm_calls_total, **labels) == before + 2
    assert sample(metrics.llm_tokens_total, **token_labels) == tokens + 26


def test_provider_failure_is_counted_once():
    connection = make_connection(Mock(side_effect=OpenAIError("private provider detail")))
    labels = {"feature": "try_once", "provider": "openai", "outcome": "error"}
    before = sample(metrics.llm_calls_total, **labels)
    with metrics.operation("try_once"), pytest.raises(OpenAIError):
        text_completion(connection, [{"role": "user", "content": "private"}])
    assert sample(metrics.llm_calls_total, **labels) == before + 1


def test_metrics_endpoint_excludes_automatic_http_traffic(client):
    client.get("/")
    response = client.get("/metrics")
    assert response.status_code == 200
    assert 'handler="/metrics"' not in response.text
    assert 'handler="/"' not in response.text
    assert "pms_accounts_current" in response.text


def test_known_operations_start_at_zero():
    assert (
        sample(
            metrics.operations_total, operation="prompt_restore", outcome="partial", channel="mcp"
        )
        == 0
    )


def test_unknown_metric_labels_are_rejected():
    with (
        pytest.raises(ValueError, match="Unknown telemetry operation"),
        metrics.operation("private-user-defined-name"),
    ):
        pass


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, "authentication"),
        (403, "permission"),
        (404, "not_found"),
        (409, "conflict"),
        (422, "validation"),
        (402, "budget"),
        (500, "internal"),
    ],
)
def test_bounded_error_classification(status, expected):
    assert metrics.classify_error(OperationError(status, "sensitive"))[1] == expected


def test_provider_cause_is_error_even_when_http_status_is_422():
    error = OperationError(422, "safe public text")
    error.__cause__ = OpenAIError("sensitive")
    assert metrics.classify_error(error) == ("error", "provider")


def test_budget_exception_subclasses_keep_budget_classification():
    from app.services.budget_service import BudgetExceededError

    class UserBudgetExceededError(BudgetExceededError):
        pass

    assert metrics.classify_error(UserBudgetExceededError("private")) == ("rejected", "budget")


def test_format_exception_subclasses_keep_provider_classification():
    class InvalidTemplateError(LLMResponseFormatError):
        pass

    assert metrics.classify_error(InvalidTemplateError("private")) == ("error", "provider")


def test_unrelated_exception_with_same_name_is_not_a_budget_rejection():
    fake_error_type = type("BudgetExceededError", (Exception,), {})
    assert metrics.classify_error(fake_error_type("private")) == ("error", "internal")
