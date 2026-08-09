"""
Unit tests for services/llm_client.py — the single seam where a provider
client is constructed, and the JSON-completion strategy that has to work
across providers with very different `response_format` support.
"""

import json
from unittest.mock import MagicMock, patch

from httpx import Request as HttpxRequest
from httpx import Response as HttpxResponse
from openai import APIConnectionError, AuthenticationError, BadRequestError, RateLimitError
import pytest

from app.models.user import User
from app.services.llm_client import (
    LLMResponseFormatError,
    NoProviderConfiguredError,
    StoredKeyUnreadableError,
    available_models_for,
    client_for,
    describe_llm_error,
    is_configured,
    json_completion,
    timeout_seconds_for,
    usage_from,
)
from app.services.llm_providers import PROVIDERS
from app.services.secret_store import encrypt_secret
from tests.conftest import TEST_LLM_API_KEY, TEST_LLM_MODEL, make_chat_response, make_connection

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "thing",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"value": {"type": "string"}},
            "required": ["value"],
            "additionalProperties": False,
        },
    },
}


def _user(**overrides) -> User:
    defaults = {
        "id": 1,
        "username": "u",
        "hashed_password": "x",
        "llm_provider": "openai",
        "llm_model": TEST_LLM_MODEL,
        "llm_api_key_encrypted": encrypt_secret(TEST_LLM_API_KEY),
    }
    return User(**{**defaults, **overrides})


class TestIsConfigured:
    def test_true_for_a_complete_hosted_connection(self):
        assert is_configured(_user()) is True

    def test_false_without_a_provider(self):
        assert is_configured(_user(llm_provider=None)) is False

    def test_false_without_a_model(self):
        assert is_configured(_user(llm_model=None)) is False

    def test_false_when_a_hosted_provider_has_no_key(self):
        assert is_configured(_user(llm_api_key_encrypted=None)) is False

    def test_true_for_a_keyless_self_hosted_connection(self):
        """Local inference servers accept any bearer token, so demanding a key
        would block the self-hosting case this feature exists for."""
        user = _user(
            llm_provider="ollama",
            llm_model="llama3",
            llm_api_key_encrypted=None,
            llm_base_url="http://localhost:11434/v1",
        )
        assert is_configured(user) is True

    def test_false_for_an_unknown_saved_provider(self):
        assert is_configured(_user(llm_provider="some-removed-vendor")) is False


class TestAvailableModels:
    def test_users_own_model_leads_the_list(self):
        models = available_models_for(_user(llm_model="gpt-4o"))
        assert models[0] == "gpt-4o"
        assert models.count("gpt-4o") == 1

    def test_free_text_model_still_appears(self):
        """A self-hosted server can serve any name at all."""
        user = _user(
            llm_provider="vllm",
            llm_model="mistral-7b-instruct",
            llm_api_key_encrypted=None,
            llm_base_url="http://gpu-box:8000/v1",
        )
        assert available_models_for(user) == ["mistral-7b-instruct"]

    def test_empty_when_not_configured(self):
        assert available_models_for(_user(llm_provider=None)) == []


class TestClientFor:
    def test_builds_a_client_from_the_users_own_credential(self):
        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            connection = client_for(_user())

        assert connection.provider_handle == "openai"
        assert connection.model == TEST_LLM_MODEL
        kwargs = mock_openai_cls.call_args.kwargs
        assert kwargs["api_key"] == TEST_LLM_API_KEY
        assert kwargs["base_url"] == "https://api.openai.com/v1"

    def test_two_users_get_their_own_providers(self):
        """The core guarantee of bring-your-own credentials: one user's calls
        never travel to another user's endpoint or on their key."""
        alice = _user(id=1, username="alice")
        bob = _user(
            id=2,
            username="bob",
            llm_provider="anthropic",
            llm_model="claude-sonnet-5",
            llm_api_key_encrypted=encrypt_secret("sk-ant-bobs-own-key"),
        )

        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            alice_conn = client_for(alice)
            alice_kwargs = mock_openai_cls.call_args.kwargs
            bob_conn = client_for(bob)
            bob_kwargs = mock_openai_cls.call_args.kwargs

        assert alice_conn.provider_handle == "openai"
        assert alice_kwargs["api_key"] == TEST_LLM_API_KEY
        assert alice_kwargs["base_url"] == "https://api.openai.com/v1"

        assert bob_conn.provider_handle == "anthropic"
        assert bob_conn.model == "claude-sonnet-5"
        assert bob_kwargs["api_key"] == "sk-ant-bobs-own-key"
        assert bob_kwargs["base_url"] == "https://api.anthropic.com/v1/"

    def test_model_override_wins_over_the_stored_one(self):
        with patch("app.services.llm_client.OpenAI"):
            assert client_for(_user(), "gpt-4o").model == "gpt-4o"

    def test_base_url_override_wins_over_the_provider_default(self):
        user = _user(llm_base_url="https://gateway.internal/v1")
        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            client_for(user)
        assert mock_openai_cls.call_args.kwargs["base_url"] == "https://gateway.internal/v1"

    def test_raises_when_no_provider_is_connected(self):
        with pytest.raises(NoProviderConfiguredError, match="Settings"):
            client_for(_user(llm_provider=None))

    def test_raises_when_a_hosted_provider_has_no_key(self):
        with pytest.raises(NoProviderConfiguredError, match="API key"):
            client_for(_user(llm_api_key_encrypted=None))

    def test_raises_a_distinct_error_when_the_stored_key_is_undecryptable(self):
        with pytest.raises(StoredKeyUnreadableError, match="Re-enter"):
            client_for(_user(llm_api_key_encrypted="corrupt-ciphertext"))

    def test_self_hosted_provider_needs_no_key(self):
        user = _user(llm_provider="ollama", llm_model="llama3", llm_api_key_encrypted=None)
        with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
            client_for(user)
        assert mock_openai_cls.call_args.kwargs["base_url"] == "http://localhost:11434/v1"

    def test_custom_provider_without_a_base_url_is_rejected(self):
        user = _user(llm_provider="custom", llm_api_key_encrypted=None, llm_base_url=None)
        with pytest.raises(NoProviderConfiguredError, match="base URL"):
            client_for(user)


class TestTimeouts:
    def test_self_hosted_providers_get_a_longer_ceiling(self):
        """A local model routinely takes minutes on a prompt a hosted API
        answers in seconds; a 30s ceiling would fail every self-hosted run."""
        assert timeout_seconds_for(PROVIDERS["ollama"]) > timeout_seconds_for(PROVIDERS["openai"])

    def test_env_override_applies_to_every_provider(self, monkeypatch):
        monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "12.5")
        assert timeout_seconds_for(PROVIDERS["openai"]) == 12.5
        assert timeout_seconds_for(PROVIDERS["ollama"]) == 12.5

    def test_nonsense_override_is_ignored(self, monkeypatch):
        monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "soon")
        assert timeout_seconds_for(PROVIDERS["openai"]) == PROVIDERS["openai"].timeout_seconds


class TestUsageFrom:
    def test_missing_usage_degrades_to_zero(self):
        """Some compat endpoints omit `usage` entirely — spend accounting must
        degrade, not raise."""
        response = MagicMock()
        response.usage = None
        connection = make_connection(MagicMock())

        usage = usage_from(response, connection)

        assert usage.prompt_tokens == 0
        assert usage.completion_tokens == 0
        assert usage.provider == "openai"


class TestJsonCompletion:
    def _connection(self, *responses, provider_handle="openai"):
        create = MagicMock(side_effect=list(responses))
        return make_connection(create, provider_handle=provider_handle), create

    def test_parses_a_clean_response(self):
        connection, _ = self._connection(make_chat_response(json.dumps({"value": "hi"})))

        parsed, usage = json_completion(
            connection, system_prompt="do it", user_content="input", schema=_SCHEMA
        )

        assert parsed == {"value": "hi"}
        assert usage.prompt_tokens == 100

    def test_schema_travels_in_the_prompt_for_every_provider(self):
        connection, create = self._connection(make_chat_response('{"value": "hi"}'))

        json_completion(connection, system_prompt="do it", user_content="in", schema=_SCHEMA)

        system = create.call_args.kwargs["messages"][0]["content"]
        assert "do it" in system
        assert "JSON Schema" in system
        assert '"value"' in system

    def test_json_object_form_for_providers_without_strict_schemas(self):
        connection, create = self._connection(
            make_chat_response('{"value": "hi"}'), provider_handle="ollama"
        )

        json_completion(connection, system_prompt="s", user_content="u", schema=_SCHEMA)

        assert create.call_args.kwargs["response_format"] == {"type": "json_object"}

    def test_retries_prompt_only_when_the_gateway_rejects_response_format(self):
        bad_request = BadRequestError(
            message="response_format is not supported",
            response=HttpxResponse(400, request=HttpxRequest("POST", "https://x/v1")),
            body=None,
        )
        connection, create = self._connection(bad_request, make_chat_response('{"value": "hi"}'))

        parsed, _ = json_completion(connection, system_prompt="s", user_content="u", schema=_SCHEMA)

        assert parsed == {"value": "hi"}
        assert create.call_count == 2
        assert create.call_args.kwargs.get("response_format") != _SCHEMA

    def test_retries_once_when_the_first_response_is_not_json(self):
        connection, create = self._connection(
            make_chat_response("Sure! Here you go."),
            make_chat_response('{"value": "hi"}'),
        )

        parsed, usage = json_completion(
            connection, system_prompt="s", user_content="u", schema=_SCHEMA
        )

        assert parsed == {"value": "hi"}
        assert create.call_count == 2
        # Both attempts really cost tokens, so both are billed.
        assert usage.prompt_tokens == 200
        assert usage.completion_tokens == 100

    def test_gives_up_after_the_retry_with_actionable_copy(self):
        connection, create = self._connection(
            make_chat_response("nope"), make_chat_response("still nope")
        )

        with pytest.raises(LLMResponseFormatError, match="did not return valid JSON"):
            json_completion(connection, system_prompt="s", user_content="u", schema=_SCHEMA)

        assert create.call_count == 2

    def test_recovers_json_from_surrounding_prose(self):
        connection, _ = self._connection(
            make_chat_response('Here is the result:\n{"value": "hi"}\nHope that helps!')
        )

        parsed, _ = json_completion(connection, system_prompt="s", user_content="u", schema=_SCHEMA)

        assert parsed == {"value": "hi"}

    def test_non_object_json_is_treated_as_a_format_failure(self):
        """A bare array or string satisfies json.loads but not the contract."""
        connection, _ = self._connection(
            make_chat_response('["not", "an", "object"]'),
            make_chat_response('"still not an object"'),
        )

        with pytest.raises(LLMResponseFormatError):
            json_completion(connection, system_prompt="s", user_content="u", schema=_SCHEMA)


class TestDescribeLLMError:
    def _connection(self):
        return make_connection(MagicMock(), provider_handle="anthropic", model="claude-sonnet-5")

    def test_names_the_users_provider_not_openai(self):
        exc = RateLimitError(
            message="rate limited",
            response=HttpxResponse(429, request=HttpxRequest("POST", "https://x/v1")),
            body=None,
        )

        status, detail = describe_llm_error(exc, self._connection())

        assert status == 402
        assert "Anthropic" in detail
        assert "OpenAI" not in detail

    def test_bad_key_is_the_users_to_fix(self):
        exc = AuthenticationError(
            message="bad key",
            response=HttpxResponse(401, request=HttpxRequest("POST", "https://x/v1")),
            body=None,
        )

        status, detail = describe_llm_error(exc, self._connection())

        assert status == 422
        assert "API key" in detail
        assert "Settings" in detail

    def test_unreachable_endpoint_points_at_the_base_url(self):
        exc = APIConnectionError(request=HttpxRequest("POST", "http://localhost:11434/v1"))

        status, detail = describe_llm_error(exc, self._connection())

        assert status == 502
        assert "base URL" in detail

    def test_falls_back_to_a_neutral_name_without_a_connection(self):
        _, detail = describe_llm_error(RuntimeError("boom"), None)
        assert "your AI provider" in detail

    def test_connection_errors_keep_their_own_copy(self):
        status, detail = describe_llm_error(NoProviderConfiguredError("connect one"), None)
        assert status == 422
        assert detail == "connect one"
