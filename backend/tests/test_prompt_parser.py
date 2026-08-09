"""
Unit tests for the PromptParserService and the POST /api/prompts/parse-text endpoint.
"""

import json
from unittest.mock import MagicMock, patch

from httpx import Request as HttpxRequest
from httpx import Response as HttpxResponse
from openai import AuthenticationError, OpenAIError, RateLimitError
import pytest

from app.models.billed_call import BilledCall
from app.models.prompt import Prompt
from app.models.schemas import PromptField
from app.services.prompt_parser import PromptParserService
from app.services.spend_ledger import LLMUsage
from tests.conftest import TEST_LLM_MODEL, make_chat_response, make_connection

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fields_response(fields: list[dict]) -> MagicMock:
    return make_chat_response(
        json.dumps({"fields": fields}), prompt_tokens=120, completion_tokens=45
    )


def _connection_returning(fields: list[dict]):
    create = MagicMock(return_value=_fields_response(fields))
    return make_connection(create), create


# ---------------------------------------------------------------------------
# PromptParserService unit tests
# ---------------------------------------------------------------------------


class TestPromptParserService:
    """Tests for PromptParserService.parse() — the provider client is mocked."""

    def test_parse_returns_prompt_fields(self):
        """Successful call returns a list of PromptField objects."""
        connection, _ = _connection_returning(
            [
                {"name": "goal", "content": "Write a fantasy story"},
                {"name": "style", "content": "Dark and gritty"},
            ]
        )

        result, usage = PromptParserService.parse("Write a dark fantasy story", connection)

        assert len(result) == 2
        assert all(isinstance(f, PromptField) for f in result)
        assert result[0].name == "goal"
        assert result[0].content == "Write a fantasy story"
        assert result[1].name == "style"
        assert result[1].content == "Dark and gritty"
        assert usage.provider == "openai"
        assert usage.model == TEST_LLM_MODEL
        assert usage.prompt_tokens == 120
        assert usage.completion_tokens == 45

    def test_parse_single_field_response(self):
        """Parser handles a single-field response without error."""
        connection, _ = _connection_returning([{"name": "goal", "content": "A simple goal"}])

        result, _ = PromptParserService.parse("A simple goal", connection)

        assert len(result) == 1
        assert result[0].name == "goal"
        assert result[0].content == "A simple goal"

    def test_parse_uses_the_connections_model(self):
        """The model comes from the user's own connection, not a pinned constant."""
        connection, create = _connection_returning([{"name": "goal", "content": "x"}])

        PromptParserService.parse("some text", connection)

        assert create.call_args.kwargs["model"] == TEST_LLM_MODEL

    def test_parse_sends_user_text_as_user_message(self):
        """The user's input text appears as a user-role message."""
        connection, create = _connection_returning([{"name": "goal", "content": "x"}])
        user_text = "Write a sci-fi thriller"

        PromptParserService.parse(user_text, connection)

        messages = create.call_args.kwargs["messages"]
        user_messages = [m for m in messages if m["role"] == "user"]
        assert len(user_messages) == 1
        assert user_messages[0]["content"] == user_text

    def test_parse_includes_system_message_carrying_the_schema(self):
        """The JSON contract travels in the prompt so providers that ignore
        `response_format` (e.g. Anthropic) still return usable JSON."""
        connection, create = _connection_returning([{"name": "goal", "content": "x"}])

        PromptParserService.parse("some text", connection)

        messages = create.call_args.kwargs["messages"]
        system_messages = [m for m in messages if m["role"] == "system"]
        assert len(system_messages) == 1
        assert "JSON Schema" in system_messages[0]["content"]
        assert "prompt engineering tool" in system_messages[0]["content"]

    def test_parse_uses_structured_output_on_a_capable_provider(self):
        """OpenAI supports strict schemas, so `response_format` is sent too."""
        connection, create = _connection_returning([{"name": "goal", "content": "x"}])

        PromptParserService.parse("some text", connection)

        fmt = create.call_args.kwargs["response_format"]
        assert fmt["type"] == "json_schema"
        assert "json_schema" in fmt

    def test_parse_omits_response_format_when_the_provider_ignores_it(self):
        """Anthropic documents `response_format` as ignored, so don't send it —
        the prompt-side schema contract carries the requirement instead."""
        create = MagicMock(
            return_value=_fields_response([{"name": "goal", "content": "x"}]),
        )
        connection = make_connection(create, provider_handle="anthropic", model="claude-sonnet-5")

        PromptParserService.parse("some text", connection)

        assert "response_format" not in create.call_args.kwargs

    def test_parse_recovers_json_wrapped_in_a_code_fence(self):
        """Providers without schema enforcement often fence their JSON."""
        fenced = '```json\n{"fields": [{"name": "goal", "content": "x"}]}\n```'
        connection = make_connection(MagicMock(return_value=make_chat_response(fenced)))

        result, _ = PromptParserService.parse("some text", connection)

        assert [f.name for f in result] == ["goal"]

    def test_parse_propagates_provider_errors(self):
        """Exceptions from the provider client propagate up to the caller."""
        connection = make_connection(MagicMock(side_effect=OpenAIError("API error")))

        with pytest.raises(OpenAIError):
            PromptParserService.parse("some text", connection)

    def test_parse_many_fields(self):
        """Parser correctly handles responses with many fields."""
        connection, _ = _connection_returning(
            [
                {"name": "goal", "content": "Goal content"},
                {"name": "setting", "content": "Setting content"},
                {"name": "characters", "content": "Characters content"},
                {"name": "tone", "content": "Tone content"},
                {"name": "constraints", "content": "Constraints content"},
            ]
        )

        result, _ = PromptParserService.parse("A rich and detailed prompt", connection)

        assert len(result) == 5
        names = [f.name for f in result]
        assert names == ["goal", "setting", "characters", "tone", "constraints"]


# ---------------------------------------------------------------------------
# POST /api/prompts/parse-text endpoint tests
# ---------------------------------------------------------------------------


class TestParseTextEndpoint:
    """Tests for POST /api/prompts/parse-text."""

    def _parsed_fields(self) -> tuple[list[PromptField], LLMUsage]:
        return (
            [
                PromptField(name="goal", content="Write a story"),
                PromptField(name="style", content="Poetic"),
            ],
            LLMUsage(
                provider="openai",
                model=TEST_LLM_MODEL,
                prompt_tokens=120,
                completion_tokens=45,
            ),
        )

    def test_parse_text_returns_fields(self, client, auth_headers):
        """Successful request returns the structured fields from the parser."""
        with patch("app.api.routes.TextParserService.parse", return_value=self._parsed_fields()):
            response = client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": "Write a poetic story"},
            )

        assert response.status_code == 200
        data = response.json()
        assert "fields" in data
        assert len(data["fields"]) == 2
        assert data["fields"][0]["name"] == "goal"
        assert data["fields"][0]["content"] == "Write a story"
        assert data["fields"][1]["name"] == "style"
        assert data["fields"][1]["content"] == "Poetic"

    def test_parse_text_requires_authentication(self, client):
        """Request without a token is rejected with 401."""
        response = client.post(
            "/api/prompts/parse-text",
            json={"text": "Some text"},
        )
        assert response.status_code == 401

    def test_parse_text_rejects_empty_text(self, client, auth_headers):
        """Empty text string fails schema validation."""
        response = client.post(
            "/api/prompts/parse-text",
            headers=auth_headers,
            json={"text": ""},
        )
        assert response.status_code == 422

    def test_parse_text_rejects_missing_text_field(self, client, auth_headers):
        """Request without the text field fails schema validation."""
        response = client.post(
            "/api/prompts/parse-text",
            headers=auth_headers,
            json={},
        )
        assert response.status_code == 422

    def test_parse_text_requires_a_connected_provider(self, client, auth_headers):
        """With no provider connected the request is refused up front, with
        copy pointing at Settings rather than a generic upstream failure."""
        client.delete("/api/auth/me/llm-connection", headers=auth_headers)

        with patch("app.api.routes.TextParserService.parse") as mock_parse:
            response = client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": "Some text"},
            )

        assert response.status_code == 422
        assert "Settings" in response.json()["detail"]
        mock_parse.assert_not_called()

    def test_parse_text_returns_502_on_generic_provider_error(self, client, auth_headers):
        """A generic provider error results in a 502 with provider-neutral copy."""
        with patch("app.api.routes.TextParserService.parse", side_effect=OpenAIError("API down")):
            response = client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": "Some text"},
            )

        assert response.status_code == 502
        detail = response.json()["detail"]
        assert "OpenAI" in detail  # names the *user's* provider, not a hardcoded vendor
        assert "unexpected error" in detail

    def test_parse_text_returns_402_on_quota_exceeded(self, client, auth_headers):
        """A RateLimitError from quota exhaustion results in a 402 response."""
        quota_error = RateLimitError(
            message="insufficient_quota",
            response=HttpxResponse(429, request=HttpxRequest("POST", "https://api.openai.com")),
            body={"error": {"code": "insufficient_quota"}},
        )

        with patch("app.api.routes.TextParserService.parse", side_effect=quota_error):
            response = client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": "Some text"},
            )

        assert response.status_code == 402
        assert "quota" in response.json()["detail"].lower()

    def test_parse_text_returns_422_on_bad_api_key(self, client, auth_headers):
        """A rejected key is the user's to fix, so it points at Settings."""
        auth_error = AuthenticationError(
            message="invalid_api_key",
            response=HttpxResponse(401, request=HttpxRequest("POST", "https://api.openai.com")),
            body={"error": {"code": "invalid_api_key"}},
        )

        with patch("app.api.routes.TextParserService.parse", side_effect=auth_error):
            response = client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": "Some text"},
            )

        assert response.status_code == 422
        assert "API key" in response.json()["detail"]

    def test_parse_text_returns_502_on_unexpected_error(self, client, auth_headers):
        """Unexpected non-provider exceptions result in a 502 response."""
        with patch(
            "app.api.routes.TextParserService.parse", side_effect=RuntimeError("unexpected")
        ):
            response = client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": "Some text"},
            )

        assert response.status_code == 502
        assert "failed" in response.json()["detail"].lower()

    def test_parse_text_passes_exact_input_to_service(self, client, auth_headers):
        """The exact user text is forwarded to the parser service."""
        user_text = "A very specific user-provided description"

        with patch(
            "app.api.routes.TextParserService.parse", return_value=self._parsed_fields()
        ) as mock_parse:
            client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": user_text},
            )

        assert mock_parse.call_args.args[0] == user_text

    def test_parse_text_does_not_persist_to_database(self, client, auth_headers, db_session):
        """Calling parse-text does not create any Prompt records."""
        with patch("app.api.routes.TextParserService.parse", return_value=self._parsed_fields()):
            response = client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": "Some text"},
            )

        assert response.status_code == 200
        assert db_session.query(Prompt).count() == 0

    def test_parse_text_records_spend_ledger_row(self, client, auth_headers, db_session):
        """A successful parse writes one billed_calls row with source 'parse'."""
        with patch("app.api.routes.TextParserService.parse", return_value=self._parsed_fields()):
            response = client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": "Some text"},
            )

        assert response.status_code == 200
        billed = db_session.query(BilledCall).one()
        assert billed.source == "parse"
        assert billed.provider == "openai"
        assert billed.prompt_tokens == 120
        assert billed.completion_tokens == 45
        assert billed.cost_usd > 0

    def test_parse_text_returns_402_when_budget_exceeded(
        self, client, auth_headers, monkeypatch, db_session
    ):
        """A reached spend ceiling rejects the request before the LLM is called."""
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "1.0")
        db_session.add(
            BilledCall(
                user_id=1,
                source="playground",
                provider="openai",
                model="gpt-4o-mini",
                cost_usd=2.0,
            )
        )
        db_session.commit()

        with patch("app.api.routes.TextParserService.parse") as mock_parse:
            response = client.post(
                "/api/prompts/parse-text",
                headers=auth_headers,
                json={"text": "Some text"},
            )

        assert response.status_code == 402
        mock_parse.assert_not_called()
