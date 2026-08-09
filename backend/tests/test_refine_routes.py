"""
Tests for the Refine tab API: clarifying questions and draft generation.
"""

from unittest.mock import patch

from httpx import Request as HttpxRequest
from httpx import Response as HttpxResponse
from openai import OpenAIError, RateLimitError

from app.models.billed_call import BilledCall
from app.services.spend_ledger import LLMUsage

_USAGE = LLMUsage(
    provider="openai", model="gpt-4.1-mini-2025-04-14", prompt_tokens=80, completion_tokens=30
)


def _create_saved_prompt(client, headers, template="Write about {{topic}}") -> int:
    response = client.post(
        "/api/prompts/generate",
        headers=headers,
        json={"fields": [{"name": "goal", "content": "x"}], "name": "Refine Prompt"},
    )
    prompt_id = response.json()["id"]
    client.patch(f"/api/prompts/{prompt_id}", headers=headers, json={"generated_prompt": template})
    return prompt_id


class TestRefineQuestionsEndpoint:
    def test_returns_questions(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)

        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_clarifying_questions",
            return_value=(["What tone?", "Who is the audience?"], _USAGE),
        ):
            resp = client.post(f"/api/prompts/{prompt_id}/refine/questions", headers=auth_headers)

        assert resp.status_code == 200
        assert resp.json()["questions"] == ["What tone?", "Who is the audience?"]

    def test_records_spend_ledger_row(self, client, auth_headers, db_session):
        prompt_id = _create_saved_prompt(client, auth_headers)

        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_clarifying_questions",
            return_value=(["What tone?"], _USAGE),
        ):
            resp = client.post(f"/api/prompts/{prompt_id}/refine/questions", headers=auth_headers)

        assert resp.status_code == 200
        billed = db_session.query(BilledCall).one()
        assert billed.source == "refine_questions"
        assert billed.prompt_tokens == 80
        assert billed.cost_usd > 0

    def test_passes_force_option_to_refiner(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)

        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_clarifying_questions",
            return_value=(["Would an example help?"], _USAGE),
        ) as mock_generate:
            resp = client.post(
                f"/api/prompts/{prompt_id}/refine/questions?force=true",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert mock_generate.call_args.args[0] == "Write about {{topic}}"
        assert mock_generate.call_args.kwargs == {"force": True}

    def test_requires_auth(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(f"/api/prompts/{prompt_id}/refine/questions")
        assert resp.status_code in (401, 403)

    def test_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/refine/questions", headers=second_auth_headers
        )
        assert resp.status_code == 404

    def test_returns_402_on_quota_exceeded(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        quota_error = RateLimitError(
            message="insufficient_quota",
            response=HttpxResponse(429, request=HttpxRequest("POST", "https://api.openai.com")),
            body={"error": {"code": "insufficient_quota"}},
        )
        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_clarifying_questions",
            side_effect=quota_error,
        ):
            resp = client.post(f"/api/prompts/{prompt_id}/refine/questions", headers=auth_headers)
        assert resp.status_code == 402

    def test_returns_502_on_openai_error(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_clarifying_questions",
            side_effect=OpenAIError("down"),
        ):
            resp = client.post(f"/api/prompts/{prompt_id}/refine/questions", headers=auth_headers)
        assert resp.status_code == 502

    def test_returns_402_when_budget_exceeded(self, client, auth_headers, monkeypatch):
        prompt_id = _create_saved_prompt(client, auth_headers)
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "0")
        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_clarifying_questions"
        ) as mock_generate:
            resp = client.post(f"/api/prompts/{prompt_id}/refine/questions", headers=auth_headers)
        assert resp.status_code == 402
        assert "budget" in resp.json()["detail"].lower()
        mock_generate.assert_not_called()


class TestRefineDraftEndpoint:
    def test_returns_draft(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)

        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_draft",
            return_value=("A revised template", _USAGE),
        ):
            resp = client.post(
                f"/api/prompts/{prompt_id}/refine/draft",
                headers=auth_headers,
                json={"qa_pairs": [{"question": "What tone?", "answer": "Formal"}]},
            )

        assert resp.status_code == 200
        assert resp.json()["draft"] == "A revised template"

    def test_records_spend_ledger_row(self, client, auth_headers, db_session):
        prompt_id = _create_saved_prompt(client, auth_headers)

        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_draft",
            return_value=("A revised template", _USAGE),
        ):
            resp = client.post(
                f"/api/prompts/{prompt_id}/refine/draft",
                headers=auth_headers,
                json={"qa_pairs": [{"question": "q", "answer": "a"}]},
            )

        assert resp.status_code == 200
        billed = db_session.query(BilledCall).one()
        assert billed.source == "refine_draft"
        assert billed.completion_tokens == 30

    def test_rejects_empty_qa_pairs(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/refine/draft",
            headers=auth_headers,
            json={"qa_pairs": []},
        )
        assert resp.status_code == 422

    def test_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/refine/draft",
            headers=second_auth_headers,
            json={"qa_pairs": [{"question": "q", "answer": "a"}]},
        )
        assert resp.status_code == 404

    def test_returns_502_on_openai_error(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_draft",
            side_effect=OpenAIError("down"),
        ):
            resp = client.post(
                f"/api/prompts/{prompt_id}/refine/draft",
                headers=auth_headers,
                json={"qa_pairs": [{"question": "q", "answer": "a"}]},
            )
        assert resp.status_code == 502

    def test_returns_402_when_budget_exceeded(self, client, auth_headers, monkeypatch):
        prompt_id = _create_saved_prompt(client, auth_headers)
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "0")
        with patch("app.api.refine_routes.PromptRefinerService.generate_draft") as mock_generate:
            resp = client.post(
                f"/api/prompts/{prompt_id}/refine/draft",
                headers=auth_headers,
                json={"qa_pairs": [{"question": "q", "answer": "a"}]},
            )
        assert resp.status_code == 402
        assert "budget" in resp.json()["detail"].lower()
        mock_generate.assert_not_called()

    def test_accept_flow_labels_the_pre_refine_snapshot(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)

        with patch(
            "app.api.refine_routes.PromptRefinerService.generate_draft",
            return_value=("A revised template", _USAGE),
        ):
            draft = client.post(
                f"/api/prompts/{prompt_id}/refine/draft",
                headers=auth_headers,
                json={"qa_pairs": [{"question": "q", "answer": "a"}]},
            ).json()["draft"]

        update_resp = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"generated_prompt": draft, "note": "Before AI refinement"},
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["generated_prompt"] == "A revised template"

        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        assert versions[0]["note"] == "Before AI refinement"
        assert versions[0]["generated_prompt"] == "Write about {{topic}}"
