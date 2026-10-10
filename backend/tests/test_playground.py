"""
Unit tests for PlaygroundService and prompt_compiler. The standalone
Playground was retired, but evaluations still run prompts through
PlaygroundService. The provider SDK client is always mocked, at the single
construction site in services/llm_client.py.
"""

from unittest.mock import MagicMock

from openai import OpenAIError
import pytest

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
