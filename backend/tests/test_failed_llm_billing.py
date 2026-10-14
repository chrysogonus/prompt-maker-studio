"""Provider usage remains billable when a successful response cannot be used."""

from openai import OpenAIError
import pytest

from app.models.billed_call import BilledCall
from tests.conftest import make_chat_response


@pytest.mark.parametrize(
    ("content", "expected_input"), [("not JSON", 200), ('{"questions": null}', 100)]
)
def test_failed_refinement_records_received_usage(
    client, auth_headers, db_session, mock_llm, content, expected_input
):
    mock_llm.return_value.chat.completions.create.return_value = make_chat_response(content)
    response = client.post(
        "/api/prompts/refine/questions",
        headers=auth_headers,
        json={"fields": [{"name": "Goal", "content": "test"}]},
    )
    assert response.status_code == 502
    calls = db_session.query(BilledCall).all()
    assert sum(call.prompt_tokens for call in calls) == expected_input
    assert all(call.source == "refine_questions" for call in calls)


def test_failed_retry_retains_usage_of_previous_response(
    client, auth_headers, db_session, mock_llm
):
    mock_llm.return_value.chat.completions.create.side_effect = [
        make_chat_response("not JSON"),
        OpenAIError("provider unavailable"),
    ]
    response = client.post(
        "/api/prompts/refine/questions",
        headers=auth_headers,
        json={"fields": [{"name": "Goal", "content": "test"}]},
    )
    assert response.status_code == 502
    calls = db_session.query(BilledCall).all()
    assert sum(call.prompt_tokens for call in calls) == 100


def test_successful_retry_is_billed_exactly_once(client, auth_headers, db_session, mock_llm):
    mock_llm.return_value.chat.completions.create.side_effect = [
        make_chat_response("not JSON"),
        make_chat_response('{"questions": ["Tone?"]}'),
    ]
    response = client.post(
        "/api/prompts/refine/questions",
        headers=auth_headers,
        json={"fields": [{"name": "Goal", "content": "test"}]},
    )
    assert response.status_code == 200
    assert sum(call.prompt_tokens for call in db_session.query(BilledCall)) == 200


def test_invalid_parse_fields_still_records_usage(client, auth_headers, db_session, mock_llm):
    mock_llm.return_value.chat.completions.create.return_value = make_chat_response(
        '{"fields": []}'
    )
    response = client.post("/api/prompts/parse-text", headers=auth_headers, json={"text": "test"})
    assert response.status_code == 502
    assert sum(call.prompt_tokens for call in db_session.query(BilledCall)) == 100


def test_invalid_eval_proposals_still_record_usage(client, auth_headers, db_session, mock_llm):
    prompt = client.post(
        "/api/prompts",
        headers=auth_headers,
        json={"fields": [{"name": "Goal", "content": "test"}], "name": "P"},
    ).json()
    mock_llm.return_value.chat.completions.create.return_value = make_chat_response(
        '{"cases": null}'
    )
    response = client.post(
        f"/api/prompts/{prompt['id']}/eval/cases/generate", headers=auth_headers, json={}
    )
    assert response.status_code == 502
    assert sum(call.prompt_tokens for call in db_session.query(BilledCall)) == 100


def test_failed_judge_retains_execution_and_judgment_spend(
    client, auth_headers, db_session, mock_llm
):
    prompt = client.post(
        "/api/prompts",
        headers=auth_headers,
        json={"fields": [{"name": "Goal", "content": "test"}], "name": "P"},
    ).json()
    client.post(
        f"/api/prompts/{prompt['id']}/eval/cases",
        headers=auth_headers,
        json={"method": "judge", "criteria": "test", "variables": {}},
    )
    mock_llm.return_value.chat.completions.create.side_effect = [
        make_chat_response("hello"),
        make_chat_response('{"score": 1e400, "rationale": "test"}'),
    ]
    response = client.post(f"/api/prompts/{prompt['id']}/eval/runs", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["results"][0]["score"] is None
    calls = db_session.query(BilledCall).all()
    assert sum(call.prompt_tokens for call in calls) == 200
    assert {call.source for call in calls} == {"eval_case", "eval_judge"}
