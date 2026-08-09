"""
Unit tests for PlaygroundService, prompt_compiler, and the
POST /api/prompts/{id}/playground/run endpoint. The provider SDK client is
always mocked, at the single construction site in services/llm_client.py.
"""

from unittest.mock import MagicMock, patch

from openai import OpenAIError
import pytest

from app.models.billed_call import BilledCall
from app.models.playground_run import PlaygroundRun
from app.services.playground_service import PlaygroundRunError, PlaygroundService
from app.services.prompt_compiler import compile_prompt
from tests.conftest import TEST_LLM_MODEL, make_chat_response, make_connection

_make_openai_response = make_chat_response


class TestCompilePrompt:
    def test_substitutes_matching_variables(self):
        result = compile_prompt("Hello {{name}}!", {"name": "World"})
        assert result == "Hello World!"

    def test_leaves_unmatched_placeholders_untouched(self):
        result = compile_prompt("Hello {{name}}!", {})
        assert result == "Hello {{name}}!"

    def test_ignores_blank_values(self):
        result = compile_prompt("Hello {{name}}!", {"name": "  "})
        assert result == "Hello {{name}}!"


class TestPlaygroundService:
    def test_run_returns_output_latency_tokens_and_cost(self):
        connection = make_connection(
            MagicMock(
                return_value=_make_openai_response(
                    "Hello back!", prompt_tokens=1000, completion_tokens=1000
                )
            )
        )

        result = PlaygroundService.run("Hello!", connection)

        assert result.output_text == "Hello back!"
        assert result.provider == "openai"
        assert result.model == TEST_LLM_MODEL
        assert result.prompt_tokens == 1000
        assert result.completion_tokens == 1000
        # gpt-4o-mini: $0.15/1M in, $0.60/1M out -> 1000 tokens each = $0.00015 + $0.0006
        assert result.cost_usd == round(0.15 / 1000 + 0.60 / 1000, 6)
        assert result.latency_ms >= 0

    def test_run_wraps_provider_errors(self):
        connection = make_connection(MagicMock(side_effect=OpenAIError("boom")))

        with pytest.raises(PlaygroundRunError):
            PlaygroundService.run("Hello", connection)

    def test_run_costs_nothing_on_a_self_hosted_provider(self):
        """Local inference isn't billed per token, so the ledger must record
        0.0 rather than a hosted provider's rate for a same-named model."""
        connection = make_connection(
            MagicMock(
                return_value=_make_openai_response(
                    "hi", prompt_tokens=1_000_000, completion_tokens=1_000_000
                )
            ),
            provider_handle="ollama",
            model="llama3",
        )

        result = PlaygroundService.run("Hello", connection)

        assert result.cost_usd == 0.0
        assert result.provider == "ollama"


class TestPlaygroundRunEndpoint:
    def _create_saved_prompt(self, client, headers, template="<GOAL>\n{{topic}}\n</GOAL>") -> int:
        response = client.post(
            "/api/prompts/generate",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "x"}], "name": "Playground Prompt"},
        )
        prompt_id = response.json()["id"]
        client.patch(
            f"/api/prompts/{prompt_id}", headers=headers, json={"generated_prompt": template}
        )
        return prompt_id

    def test_run_requires_auth(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/playground/run",
            json={"model": "gpt-4o-mini", "variables": {}},
        )
        assert resp.status_code in (401, 403)

    def test_run_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/playground/run",
            headers=second_auth_headers,
            json={"model": "gpt-4o-mini", "variables": {}},
        )
        assert resp.status_code == 404

    def test_run_rejects_unsupported_model(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/playground/run",
            headers=auth_headers,
            json={"model": "not-a-real-model", "variables": {}},
        )
        assert resp.status_code == 422

    def test_run_rejects_too_many_variables(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/playground/run",
            headers=auth_headers,
            json={"model": "gpt-4o-mini", "variables": {f"v{i}": "x" for i in range(51)}},
        )
        assert resp.status_code == 422

    def test_run_success_persists_run_and_returns_metrics(self, client, auth_headers, db_session):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        mock_response = _make_openai_response("The answer is 42.")

        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            mock_openai_cls.return_value.chat.completions.create.return_value = mock_response
            resp = client.post(
                f"/api/prompts/{prompt_id}/playground/run",
                headers=auth_headers,
                json={"model": "gpt-4o-mini", "variables": {"topic": "life the universe"}},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["output_text"] == "The answer is 42."
        assert data["prompt_tokens"] == 100
        assert data["completion_tokens"] == 50
        assert data["cost_usd"] > 0

        run = db_session.query(PlaygroundRun).filter_by(prompt_id=prompt_id).one()
        assert run.status == "success"
        assert run.model == "gpt-4o-mini"
        # A successful run also lands in the unified spend ledger.
        billed = db_session.query(BilledCall).one()
        assert billed.source == "playground"
        assert billed.model == "gpt-4o-mini"
        assert billed.prompt_tokens == 100
        assert billed.completion_tokens == 50
        assert billed.cost_usd == pytest.approx(run.cost_usd)

    def test_run_substitutes_template_variables_before_calling_openai(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(
            client, auth_headers, template="<GOAL>\n{{topic}}\n</GOAL>"
        )
        mock_response = _make_openai_response("ok")

        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            mock_create = mock_openai_cls.return_value.chat.completions.create
            mock_create.return_value = mock_response
            client.post(
                f"/api/prompts/{prompt_id}/playground/run",
                headers=auth_headers,
                json={"model": "gpt-4o-mini", "variables": {"topic": "unit testing"}},
            )

        sent_content = mock_create.call_args.kwargs["messages"][0]["content"]
        assert "unit testing" in sent_content
        assert "{{topic}}" not in sent_content

    def test_run_returns_402_when_budget_exceeded(self, client, auth_headers, monkeypatch):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "0")

        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            resp = client.post(
                f"/api/prompts/{prompt_id}/playground/run",
                headers=auth_headers,
                json={"model": "gpt-4o-mini", "variables": {}},
            )

        assert resp.status_code == 402
        assert "budget" in resp.json()["detail"].lower()
        mock_openai_cls.return_value.chat.completions.create.assert_not_called()

    def test_run_failure_returns_502_and_persists_error_run(self, client, auth_headers, db_session):
        prompt_id = self._create_saved_prompt(client, auth_headers)

        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            mock_openai_cls.return_value.chat.completions.create.side_effect = OpenAIError("boom")
            resp = client.post(
                f"/api/prompts/{prompt_id}/playground/run",
                headers=auth_headers,
                json={"model": "gpt-4o-mini", "variables": {}},
            )

        assert resp.status_code == 502
        run = db_session.query(PlaygroundRun).filter_by(prompt_id=prompt_id).one()
        assert run.status == "error"
        assert run.error_message
        # No usage is reported for a failed call, so nothing is billed.
        assert db_session.query(BilledCall).count() == 0


class TestPlaygroundRunHistoryEndpoint:
    def _create_saved_prompt(self, client, headers, template="<GOAL>\n{{topic}}\n</GOAL>") -> int:
        response = client.post(
            "/api/prompts/generate",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "x"}], "name": "Playground Prompt"},
        )
        prompt_id = response.json()["id"]
        client.patch(
            f"/api/prompts/{prompt_id}", headers=headers, json={"generated_prompt": template}
        )
        return prompt_id

    def _run(self, client, headers, prompt_id, variables=None):
        mock_response = _make_openai_response("output", prompt_tokens=10, completion_tokens=5)
        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            mock_openai_cls.return_value.chat.completions.create.return_value = mock_response
            return client.post(
                f"/api/prompts/{prompt_id}/playground/run",
                headers=headers,
                json={"model": "gpt-4o-mini", "variables": variables or {}},
            )

    def test_requires_auth(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.get(f"/api/prompts/{prompt_id}/playground/runs")
        assert resp.status_code in (401, 403)

    def test_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.get(f"/api/prompts/{prompt_id}/playground/runs", headers=second_auth_headers)
        assert resp.status_code == 404

    def test_lists_runs_newest_first_with_full_metadata(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        self._run(client, auth_headers, prompt_id, {"topic": "first"})
        self._run(client, auth_headers, prompt_id, {"topic": "second"})

        resp = client.get(f"/api/prompts/{prompt_id}/playground/runs", headers=auth_headers)
        assert resp.status_code == 200
        runs = resp.json()
        assert len(runs) == 2
        assert runs[0]["id"] > runs[1]["id"]
        assert runs[0]["input_variables"] == {"topic": "second"}
        assert runs[0]["model"] == "gpt-4o-mini"
        assert runs[0]["status"] == "success"
        assert runs[0]["cost_usd"] > 0

    def test_includes_failed_runs(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            mock_openai_cls.return_value.chat.completions.create.side_effect = OpenAIError("boom")
            client.post(
                f"/api/prompts/{prompt_id}/playground/run",
                headers=auth_headers,
                json={"model": "gpt-4o-mini", "variables": {}},
            )

        resp = client.get(f"/api/prompts/{prompt_id}/playground/runs", headers=auth_headers)
        assert resp.status_code == 200
        runs = resp.json()
        assert len(runs) == 1
        assert runs[0]["status"] == "error"
        assert runs[0]["error_message"]

    def test_pagination_limit_and_offset(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        for i in range(3):
            self._run(client, auth_headers, prompt_id, {"topic": str(i)})

        first_page = client.get(
            f"/api/prompts/{prompt_id}/playground/runs?limit=2&offset=0", headers=auth_headers
        )
        assert len(first_page.json()) == 2

        second_page = client.get(
            f"/api/prompts/{prompt_id}/playground/runs?limit=2&offset=2", headers=auth_headers
        )
        assert len(second_page.json()) == 1

    def test_empty_history_returns_empty_list(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.get(f"/api/prompts/{prompt_id}/playground/runs", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []
