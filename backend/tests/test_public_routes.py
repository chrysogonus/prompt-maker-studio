"""Tests for the unauthenticated public-tool endpoints under /api/public."""

from datetime import UTC, datetime
from unittest.mock import patch

from openai import OpenAIError
import pytest

from app.models.billed_call import BilledCall
from app.models.public_billed_call import PublicBilledCall
from app.services.llm_providers import PROVIDERS
from app.services.spend_ledger import LLMUsage
from tests.conftest import make_chat_response


def test_model_prices_need_no_session(client):
    resp = client.get("/api/public/model-prices")

    assert resp.status_code == 200
    prices = resp.json()
    hosted = {handle for handle, provider in PROVIDERS.items() if provider.models}
    assert {row["provider"] for row in prices} == hosted
    luna = next(row for row in prices if row["id"] == "gpt-6-luna")
    assert luna["provider_label"] == "OpenAI"
    assert luna["label"] == "GPT-6 Luna"
    assert set(luna) == {
        "id",
        "label",
        "provider",
        "provider_label",
        "input_price_per_1m",
        "output_price_per_1m",
    }


def test_model_prices_list_only_curated_hosted_models(client):
    rows = client.get("/api/public/model-prices").json()

    for row in rows:
        assert row["id"] in PROVIDERS[row["provider"]].models


# ---------------------------------------------------------------------------
# Free refiner
# ---------------------------------------------------------------------------

_USAGE = LLMUsage(provider="openai", model="gpt-6-luna", prompt_tokens=1000, completion_tokens=500)
_SERVICE = "app.services.public_refine.PromptRefinerService"
_PROMPT = {"text": "Summarize {{notes}} for my team."}


@pytest.fixture
def public_refine(monkeypatch, server_default_llm):
    monkeypatch.setenv("PUBLIC_REFINE_ENABLED", "true")
    return server_default_llm


def test_status_reports_whether_refinement_is_offered(client, monkeypatch, server_default_llm):
    assert client.get("/api/public/refine").json() == {"available": False, "max_chars": 8000}
    monkeypatch.setenv("PUBLIC_REFINE_ENABLED", "true")
    assert client.get("/api/public/refine").json()["available"] is True
    for name in server_default_llm:
        monkeypatch.delenv(name)
    assert client.get("/api/public/refine").json()["available"] is False


def test_refine_is_off_unless_enabled(client, server_default_llm):
    assert client.post("/api/public/refine/questions", json=_PROMPT).status_code == 404
    assert client.post("/api/public/refine/draft", json=_PROMPT).status_code == 404


def test_refine_needs_a_server_default(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_REFINE_ENABLED", "true")
    resp = client.post("/api/public/refine/questions", json=_PROMPT)
    assert resp.status_code == 503
    assert "Sign in" in resp.json()["detail"]


def test_questions_need_no_session_and_spend_goes_to_the_public_ledger(
    client, db_session, public_refine
):
    with patch(
        f"{_SERVICE}.generate_clarifying_questions", return_value=(["Who reads it?"], _USAGE)
    ) as ask:
        resp = client.post("/api/public/refine/questions", json={**_PROMPT, "force": True})

    assert resp.status_code == 200
    assert resp.json() == {"questions": ["Who reads it?"]}
    assert ask.call_args.args[0] == "<TASK>\nSummarize {{notes}} for my team.\n</TASK>"
    assert ask.call_args.kwargs == {"force": True}
    row = db_session.query(PublicBilledCall).one()
    assert (row.source, row.provider, row.model) == (
        "public_refine_questions",
        "openai",
        "gpt-6-luna",
    )
    assert row.cost_usd > 0
    assert db_session.query(BilledCall).count() == 0


def test_draft_returns_the_refined_text_using_answered_questions(client, db_session, public_refine):
    draft = {
        "fields": [{"name": "Task", "content": "Summarize {{notes}} for my team in five bullets."}]
    }
    with patch(f"{_SERVICE}.generate_section_draft", return_value=(draft, _USAGE)) as write:
        resp = client.post(
            "/api/public/refine/draft",
            json={
                **_PROMPT,
                "qa_pairs": [
                    {"question": "Length?", "answer": "Five bullets"},
                    {"question": "Tone?", "answer": "  "},
                ],
            },
        )

    assert resp.status_code == 200
    assert resp.json() == {"text": "Summarize {{notes}} for my team in five bullets."}
    assert write.call_args.args[1] == [("Length?", "Five bullets")]
    assert db_session.query(PublicBilledCall).one().source == "public_refine_draft"


def test_a_draft_that_drops_variables_is_rejected_but_still_billed(
    client, db_session, public_refine
):
    draft = {"fields": [{"name": "Task", "content": "Summarize the notes."}]}
    with patch(f"{_SERVICE}.generate_section_draft", return_value=(draft, _USAGE)):
        resp = client.post("/api/public/refine/draft", json=_PROMPT)

    assert resp.status_code >= 400
    assert db_session.query(PublicBilledCall).count() == 1


def test_provider_failures_are_reported_without_detail(client, public_refine):
    with patch(f"{_SERVICE}.generate_clarifying_questions", side_effect=OpenAIError("boom")):
        resp = client.post("/api/public/refine/questions", json=_PROMPT)
    assert resp.status_code >= 500
    assert "boom" not in resp.text


@pytest.mark.parametrize(
    "body",
    [
        {"text": ""},
        {"text": "   "},
        {"text": "x" * 8001},
        {**_PROMPT, "website": "https://spam.example"},
        {**_PROMPT, "qa_pairs": [{"question": "q", "answer": "a"}] * 6},
    ],
)
def test_invalid_or_bot_requests_are_rejected_before_any_call(client, public_refine, body):
    with patch(f"{_SERVICE}.generate_section_draft") as write:
        resp = client.post("/api/public/refine/draft", json=body)
    assert resp.status_code == 422
    write.assert_not_called()


def test_daily_cap_stops_further_calls(client, db_session, public_refine, monkeypatch):
    monkeypatch.setenv("PUBLIC_REFINE_DAILY_LIMIT", "1")
    db_session.add(
        PublicBilledCall(source="public_refine_draft", provider="openai", model="m", cost_usd=0.0)
    )
    db_session.commit()
    with patch(f"{_SERVICE}.generate_clarifying_questions") as ask:
        resp = client.post("/api/public/refine/questions", json=_PROMPT)
    assert resp.status_code == 429
    assert "today" in resp.json()["detail"]
    ask.assert_not_called()


def test_public_budget_stops_free_refinement(client, db_session, public_refine, monkeypatch):
    monkeypatch.setenv("PUBLIC_MONTHLY_BUDGET_USD", "1")
    db_session.add(
        PublicBilledCall(source="public_refine_draft", provider="openai", model="m", cost_usd=1.5)
    )
    db_session.commit()
    resp = client.post("/api/public/refine/questions", json=_PROMPT)
    assert resp.status_code == 402
    assert "free refiner" in resp.json()["detail"]


def test_public_spend_counts_toward_the_shared_budget(
    client, db_session, public_refine, monkeypatch, auth_headers
):
    monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "1")
    db_session.add(
        PublicBilledCall(
            source="public_refine_draft",
            provider="openai",
            model="m",
            cost_usd=1.5,
            created_at=datetime.now(UTC),
        )
    )
    db_session.commit()

    assert client.post("/api/public/refine/questions", json=_PROMPT).status_code == 402
    # Signed-in AI features share the same ceiling.
    resp = client.post(
        "/api/prompts/refine/questions",
        headers=auth_headers,
        json={"fields": [{"name": "Task", "content": "Hi"}]},
    )
    assert resp.status_code == 402


def test_a_call_in_flight_already_counts_against_the_daily_cap(
    db_session, public_refine, monkeypatch
):
    from app.services import public_refine as service
    from app.services.errors import OperationError
    from app.services.llm_client import server_default_connection

    monkeypatch.setenv("PUBLIC_REFINE_DAILY_LIMIT", "1")
    connection = server_default_connection()
    row = service.reserve_call(db_session, connection, service.QUESTIONS_SOURCE, 100)
    # Not settled yet, as while the provider is still answering.
    with pytest.raises(OperationError) as refused:
        service.reserve_call(db_session, connection, service.DRAFT_SOURCE, 100)
    assert refused.value.status_code == 429
    service.settle_call(db_session, row, [])
    assert (row.prompt_tokens, row.cost_usd) == (0, 0.0)


@pytest.fixture
def priced_public_refine(monkeypatch):
    """A server default with published prices, so estimates are not zero."""
    monkeypatch.setenv("PUBLIC_REFINE_ENABLED", "true")
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("LLM_API_KEY", "server-default-key-not-real")
    monkeypatch.setenv("LLM_MODEL", "gpt-6-luna")


def test_a_call_is_refused_when_the_budget_cannot_cover_its_estimate(
    client, db_session, priced_public_refine, monkeypatch
):
    from app.services.budget_service import BudgetService

    monkeypatch.setenv("PUBLIC_MONTHLY_BUDGET_USD", "1000")
    estimate = BudgetService.estimated_batch_cost_usd("openai", "gpt-6-luna", 2)
    assert estimate > 0
    monkeypatch.setenv("PUBLIC_MONTHLY_BUDGET_USD", str(estimate / 2))
    with patch(f"{_SERVICE}.generate_clarifying_questions") as ask:
        resp = client.post("/api/public/refine/questions", json=_PROMPT)
    assert resp.status_code == 402
    ask.assert_not_called()
    assert db_session.query(PublicBilledCall).count() == 0


def test_a_reservation_holds_its_estimate_until_settled(
    db_session, priced_public_refine, monkeypatch
):
    from app.services import public_refine as service

    monkeypatch.setenv("PUBLIC_MONTHLY_BUDGET_USD", "1000")
    row = service.reserve_call(
        db_session, service.available_connection(), service.DRAFT_SOURCE, 100
    )
    assert row.cost_usd > 0
    service.settle_call(db_session, row, [_USAGE])
    assert (row.prompt_tokens, row.completion_tokens) == (1000, 500)


def test_a_failed_call_releases_its_estimate(client, db_session, priced_public_refine, monkeypatch):
    monkeypatch.setenv("PUBLIC_MONTHLY_BUDGET_USD", "1000")
    with patch(f"{_SERVICE}.generate_clarifying_questions", side_effect=OpenAIError("boom")):
        client.post("/api/public/refine/questions", json=_PROMPT)
    row = db_session.query(PublicBilledCall).one()
    assert row.cost_usd == 0.0


def test_one_per_visitor_limit_covers_both_steps(client, public_refine, monkeypatch):
    from app.limiter import limiter

    # Real per-client keys instead of the suite's per-request bypass.
    monkeypatch.setenv("TESTING", "false")
    limiter.reset()
    draft = {"fields": [{"name": "Task", "content": _PROMPT["text"]}]}
    try:
        with (
            patch(f"{_SERVICE}.generate_clarifying_questions", return_value=([], _USAGE)),
            patch(f"{_SERVICE}.generate_section_draft", return_value=(draft, _USAGE)),
        ):
            statuses = [
                client.post("/api/public/refine/questions", json=_PROMPT).status_code,
                client.post("/api/public/refine/draft", json=_PROMPT).status_code,
                client.post("/api/public/refine/questions", json=_PROMPT).status_code,
                client.post("/api/public/refine/draft", json=_PROMPT).status_code,
            ]
    finally:
        limiter.reset()
    assert statuses == [200, 200, 200, 429]


def test_public_calls_cap_the_answer_length(client, public_refine, mock_llm, monkeypatch):
    monkeypatch.setenv("PUBLIC_REFINE_MAX_OUTPUT_TOKENS", "1234")
    mock_llm.return_value.chat.completions.create.return_value = make_chat_response(
        '{"questions": ["Who reads it?"]}'
    )

    resp = client.post("/api/public/refine/questions", json=_PROMPT)

    assert resp.status_code == 200
    # The server default in these tests is a vLLM endpoint, which takes max_tokens.
    assert mock_llm.return_value.chat.completions.create.call_args.kwargs["max_tokens"] == 1234


def test_the_estimate_covers_the_input_and_the_capped_answer(priced_public_refine, monkeypatch):
    from app.services import public_refine as service

    monkeypatch.setenv("PUBLIC_MONTHLY_BUDGET_USD", "1000")
    connection = service.available_connection()
    short, long = (service.estimated_cost_usd(connection, chars) for chars in (100, 8000))
    assert 0 < short < long
    monkeypatch.setenv("PUBLIC_REFINE_MAX_OUTPUT_TOKENS", "100")
    assert service.estimated_cost_usd(service.available_connection(), 100) < short


def test_returned_questions_can_all_be_answered_in_a_draft(client, public_refine):
    asked = [f"Question {i}?" for i in range(8)]
    draft = {"fields": [{"name": "Task", "content": _PROMPT["text"]}]}
    with (
        patch(f"{_SERVICE}.generate_clarifying_questions", return_value=(asked, _USAGE)),
        patch(f"{_SERVICE}.generate_section_draft", return_value=(draft, _USAGE)),
    ):
        questions = client.post("/api/public/refine/questions", json=_PROMPT).json()["questions"]
        resp = client.post(
            "/api/public/refine/draft",
            json={**_PROMPT, "qa_pairs": [{"question": q, "answer": "yes"} for q in questions]},
        )
    assert questions == asked[:5]
    assert resp.status_code == 200
