"""Operations measure completed business work, including non-HTTP failures."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from prometheus_client import REGISTRY
import pytest

from app.auth.utils import hash_password_reset_token
from app.metrics import channel_context, operation, operation_context, request_id_context
from app.models.billed_call import BilledCall
from app.models.eval_case import EvalCase
from app.models.prompt import Prompt
from app.models.user import User
from app.schemas.accounts import UserCreate
from app.schemas.prompts import PromptCreateRequest
from app.services.accounts import registration
from app.services.budget_service import BudgetExceededError
from app.services.eval_service import EvalService, JudgeError
from app.services.playground_service import PlaygroundResult, PlaygroundRunError
from app.services.prompts import library
from tests.conftest import make_chat_response, make_connection


def _count(operation_name: str, outcome: str = "success", channel: str = "rest") -> float:
    return (
        REGISTRY.get_sample_value(
            "pms_operations_total",
            {"operation": operation_name, "outcome": outcome, "channel": channel},
        )
        or 0
    )


def _case_count(method: str, outcome: str) -> float:
    return (
        REGISTRY.get_sample_value("pms_eval_cases_total", {"method": method, "outcome": outcome})
        or 0
    )


def test_signup_and_login_record_success_and_rejection(client):
    signup_success = _count("signup")
    signup_rejected = _count("signup", "rejected")
    credentials = {"username": "metricuser", "password": "testpass123"}
    body = {**credentials, "email": "metric@example.com"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    assert client.post("/api/auth/register", json=body).status_code == 400
    assert _count("signup") == signup_success + 1
    assert _count("signup", "rejected") == signup_rejected + 1

    login_success = _count("login")
    login_rejected = _count("login", "rejected")
    assert client.post("/api/auth/login", json=credentials).status_code == 200
    assert (
        client.post("/api/auth/login", json={**credentials, "password": "wrongpass"}).status_code
        == 401
    )
    assert _count("login") == login_success + 1
    assert _count("login", "rejected") == login_rejected + 1


def test_signup_commit_failure_does_not_record_success(db_session):
    success = _count("signup")
    errors = _count("signup", "error")
    body = UserCreate(username="metricuser", password="testpass123", email="m@example.com")
    with (
        patch.object(db_session, "commit", side_effect=RuntimeError("commit failed")),
        pytest.raises(RuntimeError, match="commit failed"),
    ):
        registration.register(body, db_session)
    db_session.rollback()
    assert db_session.query(User).count() == 0
    assert _count("signup") == success
    assert _count("signup", "error") == errors + 1


def test_rejected_account_delete_preserves_account(client, auth_headers, db_session):
    before = _count("account_delete", "rejected")
    response = client.request(
        "DELETE", "/api/auth/me", headers=auth_headers, json={"current_password": "wrongpass"}
    )
    assert response.status_code == 401
    assert db_session.query(User).count() == 1
    assert _count("account_delete", "rejected") == before + 1


@pytest.mark.parametrize("channel", ["rest", "mcp"])
def test_shared_prompt_mutations_count_once_after_commit(db_session, channel):
    user = User(username="metricuser", email="m@example.com", hashed_password="x")
    db_session.add(user)
    db_session.commit()
    before = _count("prompt_create", channel=channel)
    token = channel_context.set(channel)
    try:
        prompt = library.create_prompt(
            PromptCreateRequest(name="Metric prompt", fields=[{"name": "task", "content": "hi"}]),
            db_session,
            user.id,
        )
    finally:
        channel_context.reset(token)
    assert db_session.get(Prompt, prompt.id) is not None
    assert _count("prompt_create", channel=channel) == before + 1


def test_prompt_commit_failure_does_not_record_success(db_session):
    user = User(username="metricuser", email="m@example.com", hashed_password="x")
    db_session.add(user)
    db_session.commit()
    before = _count("prompt_create")
    errors = _count("prompt_create", "error")
    with (
        patch.object(db_session, "commit", side_effect=RuntimeError("commit failed")),
        pytest.raises(RuntimeError, match="commit failed"),
    ):
        library.create_prompt(
            PromptCreateRequest(name="Metric prompt", fields=[{"name": "task", "content": "hi"}]),
            db_session,
            user.id,
        )
    db_session.rollback()
    assert db_session.query(Prompt).count() == 0
    assert _count("prompt_create") == before
    assert _count("prompt_create", "error") == errors + 1


def test_rest_prompt_mutations_each_count_once(client, auth_headers):
    names = (
        "prompt_create",
        "prompt_update",
        "prompt_duplicate",
        "prompt_restore",
        "prompt_delete",
    )
    before = {name: _count(name) for name in names}
    response = client.post(
        "/api/prompts",
        headers=auth_headers,
        json={"name": "Metric", "fields": [{"name": "task", "content": "First"}]},
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]
    path = f"/api/prompts/{prompt_id}"
    assert (
        client.patch(
            path, headers=auth_headers, json={"fields": [{"name": "task", "content": "Second"}]}
        ).status_code
        == 200
    )
    assert client.post(f"{path}/duplicate", headers=auth_headers).status_code == 200
    versions = client.get(f"{path}/versions", headers=auth_headers).json()
    assert (
        client.post(
            f"{path}/versions/{versions[0]['id']}/restore", headers=auth_headers
        ).status_code
        == 200
    )
    assert client.delete(path, headers=auth_headers).status_code == 204
    assert {name: _count(name) - before[name] for name in names} == dict.fromkeys(names, 1)


@pytest.mark.parametrize(
    ("suffix", "operation_name", "body"),
    [
        ("parse-text", "ai_import", {"text": "Make a prompt"}),
        ("try", "try_once", {"text": "Try this"}),
        ("refine/questions", "refine_questions", {"fields": [{"name": "task", "content": "Hi"}]}),
        ("{prompt_id}/refine/questions", "refine_questions", None),
        (
            "refine/draft",
            "refine_draft",
            {
                "fields": [{"name": "task", "content": "Hi"}],
                "qa_pairs": [{"question": "Who?", "answer": "Everyone"}],
            },
        ),
        (
            "{prompt_id}/refine/draft",
            "refine_draft",
            {"qa_pairs": [{"question": "Who?", "answer": "Everyone"}]},
        ),
        ("{prompt_id}/eval/cases/generate", "eval_generate", {"goal": "Try basic cases"}),
        ("{prompt_id}/eval/runs", "eval_run", None),
    ],
)
def test_ai_budget_rejection_counts_at_boundary(client, auth_headers, suffix, operation_name, body):
    response = client.post(
        "/api/prompts",
        headers=auth_headers,
        json={"name": "Metric", "fields": [{"name": "task", "content": "Hi"}]},
    )
    assert response.status_code == 201
    before = _count(operation_name, "rejected")
    with patch(
        "app.services.budget_service.BudgetService.check",
        side_effect=BudgetExceededError("budget exceeded"),
    ):
        response = client.post(
            f"/api/prompts/{suffix.format(prompt_id=response.json()['id'])}",
            headers=auth_headers,
            json=body,
        )
    assert response.status_code == 402
    assert _count(operation_name, "rejected") == before + 1


def test_validation_failure_before_boundary_does_not_count_operation(client, auth_headers):
    before = {
        outcome: _count("refine_questions", outcome) for outcome in ("success", "rejected", "error")
    }
    response = client.post(
        "/api/prompts/refine/questions", headers=auth_headers, json={"fields": []}
    )
    assert response.status_code == 422
    assert {outcome: _count("refine_questions", outcome) for outcome in before} == before


def test_invalid_ai_conversion_records_error_and_retains_billed_usage(
    client, auth_headers, db_session, mock_llm
):
    errors = _count("ai_import", "error")
    success = _count("ai_import")
    labels = {"feature": "ai_import", "provider": "openai", "direction": "input"}
    tokens = REGISTRY.get_sample_value("pms_llm_tokens_total", labels) or 0
    mock_llm.return_value.chat.completions.create.return_value = make_chat_response(
        '{"fields": [], "variables": []}', prompt_tokens=17, completion_tokens=4
    )
    response = client.post(
        "/api/prompts/parse-text",
        headers=auth_headers,
        json={"text": "Make a prompt", "extract_variables": True},
    )
    assert response.status_code == 502
    assert _count("ai_import", "error") == errors + 1
    assert _count("ai_import") == success
    assert REGISTRY.get_sample_value("pms_llm_tokens_total", labels) == tokens + 17
    billed = db_session.query(BilledCall).one()
    assert billed.source == "parse"
    assert billed.prompt_tokens == 17


@pytest.mark.parametrize("fails", [False, True])
def test_password_mail_outcome_preserves_generic_response(
    client, auth_headers, db_session, fails, caplog
):
    outcome = "error" if fails else "success"
    before = _count("password_reset_email", outcome)
    with patch(
        "app.services.accounts.passwords.send_password_reset_email",
        side_effect=RuntimeError("smtp password secret") if fails else None,
    ):
        response = client.post("/api/auth/forgot-password", json={"email": "testuser@example.com"})
    assert response.status_code == 200
    assert response.json() == {
        "message": "If that email is registered, a reset link has been sent."
    }
    assert _count("password_reset_email", outcome) == before + 1
    db_session.expire_all()
    user = db_session.query(User).one()
    assert (user.reset_token is None) is fails
    assert "smtp password secret" not in caplog.text
    assert "testuser@example.com" not in caplog.text


def test_unknown_password_email_does_not_count_delivery(client):
    success = _count("password_reset_email")
    errors = _count("password_reset_email", "error")
    assert (
        client.post("/api/auth/forgot-password", json={"email": "unknown@example.com"}).status_code
        == 200
    )
    assert _count("password_reset_email") == success
    assert _count("password_reset_email", "error") == errors


def test_password_reset_records_success_and_rejection(client, auth_headers, db_session):
    user = db_session.query(User).one()
    user.reset_token = hash_password_reset_token("valid-token")
    user.reset_token_expiry = datetime.now(UTC) + timedelta(hours=1)
    db_session.commit()
    success = _count("password_reset")
    rejected = _count("password_reset", "rejected")
    body = {"token": "valid-token", "new_password": "replacement123"}
    assert client.post("/api/auth/reset-password", json=body).status_code == 200
    assert client.post("/api/auth/reset-password", json=body).status_code == 400
    assert _count("password_reset") == success + 1
    assert _count("password_reset", "rejected") == rejected + 1


@pytest.mark.parametrize(("failure", "outcome"), [("budget", "rejected"), ("provider", "error")])
def test_connection_false_result_records_failure(client, auth_headers, failure, outcome):
    before = _count("connection_test", outcome)
    success = _count("connection_test")
    target = (
        "app.services.accounts.connections.BudgetService.check"
        if failure == "budget"
        else "app.services.accounts.connections.text_completion"
    )
    error = (
        BudgetExceededError("budget exceeded")
        if failure == "budget"
        else RuntimeError("bad provider")
    )
    with patch(target, side_effect=error):
        response = client.post("/api/auth/me/llm-connection/test", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert _count("connection_test", outcome) == before + 1
    assert _count("connection_test") == success


def _evaluation(db_session, methods):
    user = User(username="metricuser", email="m@example.com", hashed_password="x")
    db_session.add(user)
    db_session.flush()
    prompt = Prompt(user_id=user.id, name="Metric", fields=[], generated_prompt="Reply")
    db_session.add(prompt)
    db_session.flush()
    for index, method in enumerate(methods):
        db_session.add(
            EvalCase(prompt_id=prompt.id, method=method, criteria="hello", position=index)
        )
    db_session.commit()
    return prompt, user


def _result():
    return PlaygroundResult("goodbye", 1, 2, 3, 0.0, "openai", "gpt-4o-mini")


def test_eval_partial_is_counted_once_despite_http_success(client, auth_headers):
    prompt = client.post(
        "/api/prompts",
        headers=auth_headers,
        json={"name": "Metric", "fields": [{"name": "task", "content": "Hi"}]},
    ).json()
    path = f"/api/prompts/{prompt['id']}/eval"
    assert (
        client.post(
            f"{path}/cases", headers=auth_headers, json={"method": "rule", "criteria": "hello"}
        ).status_code
        == 200
    )
    partial = _count("eval_run", "partial")
    success = _count("eval_run")
    with patch(
        "app.services.eval_service.PlaygroundService.run",
        side_effect=PlaygroundRunError("provider failed"),
    ):
        response = client.post(f"{path}/runs", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["results"][0]["score"] is None
    assert _count("eval_run", "partial") == partial + 1
    assert _count("eval_run") == success


@pytest.mark.parametrize(
    ("method", "failure", "case_outcome"),
    [
        ("rule", None, "scored"),
        ("manual", None, "pending_manual"),
        ("rule", "execution", "execution_error"),
        ("judge", "judge", "judge_error"),
    ],
)
def test_evaluation_tracks_structured_case_outcomes(db_session, method, failure, case_outcome):
    prompt, user = _evaluation(db_session, [method])
    before = _case_count(method, case_outcome)
    with (
        patch("app.services.eval_service.client_for", return_value=make_connection(None)),
        patch(
            "app.services.eval_service.PlaygroundService.run",
            return_value=_result(),
            side_effect=PlaygroundRunError("failed") if failure == "execution" else None,
        ),
        patch(
            "app.services.eval_service.EvalService._score_judge", side_effect=JudgeError("failed")
        ),
        operation("eval_run") as state,
    ):
        run = EvalService.run_evaluation(db_session, prompt, user)
    assert state.outcome == ("partial" if failure else "success")
    assert len(run.results) == 1
    if method == "rule" and failure is None:
        assert run.score == 0
    assert _case_count(method, case_outcome) == before + 1


def test_eval_workers_receive_fresh_copies_of_context(db_session):
    prompt, user = _evaluation(db_session, ["rule", "rule"])
    seen = []

    def execute(*args):
        seen.append(
            (request_id_context.get(), channel_context.get(), operation_context.get().operation)
        )
        request_id_context.set("worker-local")
        return _result()

    request_token = request_id_context.set("parent-request")
    channel_token = channel_context.set("mcp")
    try:
        with (
            patch("app.services.eval_service.client_for", return_value=make_connection(None)),
            patch("app.services.eval_service.PlaygroundService.run", side_effect=execute),
            patch(
                "app.services.eval_service.ThreadPoolExecutor",
                side_effect=lambda **_kwargs: ThreadPoolExecutor(max_workers=1),
            ),
            operation("eval_run"),
        ):
            EvalService.run_evaluation(db_session, prompt, user)
        assert request_id_context.get() == "parent-request"
    finally:
        request_id_context.reset(request_token)
        channel_context.reset(channel_token)
    assert seen == [("parent-request", "mcp", "eval_run")] * 2


def test_eval_commit_failure_does_not_count_case_results(db_session):
    prompt, user = _evaluation(db_session, ["manual"])
    before = _case_count("manual", "pending_manual")
    with (
        patch("app.services.eval_service.client_for", return_value=make_connection(None)),
        patch("app.services.eval_service.PlaygroundService.run", return_value=_result()),
        patch.object(db_session, "commit", side_effect=RuntimeError("commit failed")),
        pytest.raises(RuntimeError, match="commit failed"),
    ):
        EvalService.run_evaluation(db_session, prompt, user)
    db_session.rollback()
    assert _case_count("manual", "pending_manual") == before
