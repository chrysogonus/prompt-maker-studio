"""
Unit tests for PromptRefinerService — the provider client is always mocked.
"""

import json
from unittest.mock import MagicMock

from openai import OpenAIError
import pytest

from app.services.prompt_refiner import PromptRefinerService
from tests.conftest import TEST_LLM_MODEL, make_chat_response, make_connection


def _connection_returning(payload: dict):
    create = MagicMock(
        return_value=make_chat_response(json.dumps(payload), prompt_tokens=80, completion_tokens=30)
    )
    return make_connection(create), create


class TestGenerateClarifyingQuestions:
    def test_returns_list_of_questions(self):
        connection, _ = _connection_returning({"questions": ["What tone?", "Who is the audience?"]})

        result, usage = PromptRefinerService.generate_clarifying_questions(
            "Write a story about {{topic}}", connection
        )

        assert result == ["What tone?", "Who is the audience?"]
        assert usage.provider == "openai"
        assert usage.model == TEST_LLM_MODEL
        assert usage.prompt_tokens == 80
        assert usage.completion_tokens == 30

    def test_uses_the_connections_model(self):
        connection, create = _connection_returning({"questions": []})

        PromptRefinerService.generate_clarifying_questions("template", connection)

        assert create.call_args.kwargs["model"] == TEST_LLM_MODEL

    def test_force_requests_optional_questions_without_repeating_covered_axes(self):
        connection, create = _connection_returning({"questions": ["Would an example help?"]})

        PromptRefinerService.generate_clarifying_questions("template", connection, force=True)

        system_message = create.call_args.kwargs["messages"][0]["content"]
        assert "explicitly requested additional questions" in system_message
        assert "avoiding dimensions already answered" in system_message

    def test_propagates_provider_errors(self):
        connection = make_connection(MagicMock(side_effect=OpenAIError("boom")))

        with pytest.raises(OpenAIError):
            PromptRefinerService.generate_clarifying_questions("template", connection)

    def test_raises_when_the_provider_omits_the_questions_key(self):
        """A provider that ignores the schema can return well-formed JSON with
        the wrong shape; that must be a validation error, not a KeyError."""
        connection, _ = _connection_returning({"unexpected": []})

        with pytest.raises(ValueError, match="questions"):
            PromptRefinerService.generate_clarifying_questions("template", connection)


class TestGenerateDraft:
    def test_returns_draft_text(self):
        connection, _ = _connection_returning({"draft": "A revised template with {{topic}}"})

        result, usage = PromptRefinerService.generate_draft(
            "Original {{topic}}", [("What tone?", "Formal")], connection
        )

        assert result == "A revised template with {{topic}}"
        assert usage.prompt_tokens == 80
        assert usage.completion_tokens == 30

    def test_includes_qa_pairs_in_user_message(self):
        connection, create = _connection_returning({"draft": "x"})

        PromptRefinerService.generate_draft(
            "template", [("What tone?", "Formal and concise")], connection
        )

        user_message = create.call_args.kwargs["messages"][1]["content"]
        assert "What tone?" in user_message
        assert "Formal and concise" in user_message

    def test_propagates_provider_errors(self):
        connection = make_connection(MagicMock(side_effect=OpenAIError("boom")))

        with pytest.raises(OpenAIError):
            PromptRefinerService.generate_draft("template", [("q", "a")], connection)

    def test_raises_when_the_provider_returns_an_empty_draft(self):
        connection, _ = _connection_returning({"draft": "   "})

        with pytest.raises(ValueError, match="draft"):
            PromptRefinerService.generate_draft("template", [("q", "a")], connection)
