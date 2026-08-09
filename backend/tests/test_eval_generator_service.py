"""
Unit tests for EvalGeneratorService — the provider client is always mocked.
"""

import json
from unittest.mock import MagicMock

from openai import OpenAIError
import pytest

from app.services.eval_generator_service import _MAX_NAME_LENGTH, EvalGeneratorService
from tests.conftest import TEST_LLM_MODEL, make_chat_response, make_connection


def _make_openai_response(payload: dict) -> MagicMock:
    return make_chat_response(json.dumps(payload), prompt_tokens=200, completion_tokens=90)


def _connection_for(response):
    """A connection whose client returns `response`, plus the create mock."""
    create = MagicMock(return_value=response)
    return make_connection(create), create


class TestGenerateProposals:
    def test_returns_list_of_proposals(self):
        payload = {
            "cases": [
                {
                    "method": "rule",
                    "criteria": "hello",
                    "variables": {"topic": "space"},
                    "rationale": "Happy path.",
                },
                {
                    "method": "judge",
                    "criteria": "Be concise",
                    "variables": {"topic": ""},
                    "rationale": "Edge case: empty input.",
                },
            ]
        }
        mock_response = _make_openai_response(payload)

        connection, mock_create = _connection_for(mock_response)
        result, usage = EvalGeneratorService.generate_proposals(
            "Write about {{topic}}", None, None, 5, connection
        )

        assert usage.provider == "openai"
        assert usage.model == TEST_LLM_MODEL
        assert usage.prompt_tokens == 200
        assert usage.completion_tokens == 90
        assert len(result) == 2
        assert result[0].method == "rule"
        assert result[0].variables == {"topic": "space"}
        assert result[1].rationale == "Edge case: empty input."

    def test_truncates_to_max_cases(self):
        payload = {
            "cases": [
                {"method": "manual", "criteria": "", "variables": {}, "rationale": f"case {i}"}
                for i in range(5)
            ]
        }
        mock_response = _make_openai_response(payload)

        connection, mock_create = _connection_for(mock_response)
        result, _ = EvalGeneratorService.generate_proposals(
            "static template", None, None, 2, connection
        )

        assert len(result) == 2

    def test_converts_structural_literal_rule_checks_to_judge(self):
        mock_response = _make_openai_response(
            {
                "cases": [
                    {
                        "method": "rule",
                        "criteria": "eco-friendly, 2-year warranty, tagline",
                        "variables": {"product": "bottle"},
                        "rationale": "Checks required content and structure.",
                    }
                ]
            }
        )

        connection, mock_create = _connection_for(mock_response)
        result, _ = EvalGeneratorService.generate_proposals(
            "End with a one-line tagline for {{product}}", None, None, 5, connection
        )

        assert result[0].method == "judge"
        assert "Treat structural labels as concepts" in result[0].criteria
        assert "tagline" in result[0].criteria

    def test_uses_the_models_short_case_name(self):
        mock_response = _make_openai_response(
            {
                "cases": [
                    {
                        "method": "manual",
                        "name": "Happy path: standard triage note",
                        "criteria": "",
                        "variables": {},
                        "rationale": "This standard happy-path case tests the prompt end to end.",
                    }
                ]
            }
        )

        connection, mock_create = _connection_for(mock_response)
        result, _ = EvalGeneratorService.generate_proposals("template", None, None, 5, connection)

        assert result[0].name == "Happy path: standard triage note"
        # The rationale keeps its own field rather than being crammed into the name.
        assert result[0].rationale.startswith("This standard happy-path case")

    def test_falls_back_to_a_whole_word_name_when_none_is_returned(self):
        rationale = (
            "This standard happy-path case tests that the prompt can produce a "
            "concise triage note including requested details."
        )
        mock_response = _make_openai_response(
            {
                "cases": [
                    {"method": "manual", "criteria": "", "variables": {}, "rationale": rationale}
                ]
            }
        )

        connection, mock_create = _connection_for(mock_response)
        result, _ = EvalGeneratorService.generate_proposals("template", None, None, 5, connection)

        name = result[0].name
        assert len(name) <= _MAX_NAME_LENGTH
        assert name  # a label is always produced
        # Never a mid-word slice: the last word must be a whole word from the source.
        assert name.split()[-1] in rationale.split()

    def test_asks_the_model_for_a_case_name(self):
        mock_response = _make_openai_response({"cases": []})
        connection, mock_create = _connection_for(mock_response)
        EvalGeneratorService.generate_proposals("template", None, None, 5, connection)

        item_schema = mock_create.call_args.kwargs["response_format"]["json_schema"]["schema"][
            "properties"
        ]["cases"]["items"]
        assert "name" in item_schema["properties"]
        assert "name" in item_schema["required"]
        assert "short descriptive name" in mock_create.call_args.kwargs["messages"][0]["content"]

    def test_builds_schema_with_declared_variable_names(self):
        mock_response = _make_openai_response({"cases": []})
        connection, mock_create = _connection_for(mock_response)
        EvalGeneratorService.generate_proposals(
            "Hello {{name}}, welcome to {{place}}", None, None, 5, connection
        )

        schema = mock_create.call_args.kwargs["response_format"]["json_schema"]["schema"]
        variables_schema = schema["properties"]["cases"]["items"]["properties"]["variables"]
        assert set(variables_schema["properties"].keys()) == {"name", "place"}
        assert set(variables_schema["required"]) == {"name", "place"}

    def test_includes_goal_and_variable_metadata_in_user_message(self):
        mock_response = _make_openai_response({"cases": []})
        connection, mock_create = _connection_for(mock_response)
        EvalGeneratorService.generate_proposals(
            "Write about {{topic}}",
            {"topic": {"type": "text", "description": "the subject matter"}},
            "Cover ambiguous topics",
            5,
            connection,
        )

        user_message = mock_create.call_args.kwargs["messages"][1]["content"]
        assert "Cover ambiguous topics" in user_message
        assert "the subject matter" in user_message

    def test_uses_the_connections_model(self):
        mock_response = _make_openai_response({"cases": []})
        connection, mock_create = _connection_for(mock_response)
        EvalGeneratorService.generate_proposals("template", None, None, 5, connection)
        assert mock_create.call_args.kwargs["model"] == TEST_LLM_MODEL

    def test_propagates_provider_errors(self):
        connection = make_connection(MagicMock(side_effect=OpenAIError("boom")))
        with pytest.raises(OpenAIError):
            EvalGeneratorService.generate_proposals("template", None, None, 5, connection)
