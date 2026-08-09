"""
Tests for the bring-your-own provider connection API:
GET/PUT/DELETE /api/auth/me/llm-connection and its test probe.
"""

from unittest.mock import patch

from httpx import Request as HttpxRequest
from httpx import Response as HttpxResponse
from openai import AuthenticationError

from app.models.billed_call import BilledCall
from app.models.user import User
from tests.conftest import TEST_LLM_API_KEY, TEST_LLM_MODEL, make_chat_response


class TestGetConnection:
    def test_returns_the_configured_connection_and_provider_catalogue(self, client, auth_headers):
        resp = client.get("/api/auth/me/llm-connection", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is True
        assert data["provider"] == "openai"
        assert data["provider_label"] == "OpenAI"
        assert data["model"] == TEST_LLM_MODEL
        assert data["has_api_key"] is True
        handles = {p["handle"] for p in data["providers"]}
        assert {"openai", "anthropic", "gemini", "ollama", "vllm", "custom"} <= handles

    def test_never_returns_the_api_key(self, client, auth_headers):
        """The stored credential must not leave the server, in any field."""
        resp = client.get("/api/auth/me/llm-connection", headers=auth_headers)

        assert TEST_LLM_API_KEY not in resp.text
        # Only a non-reversible hint is exposed.
        assert resp.json()["api_key_hint"] == "sk-…0000"

    def test_requires_authentication(self, client):
        assert client.get("/api/auth/me/llm-connection").status_code == 401


class TestUpdateConnection:
    def test_switches_provider_with_a_new_key(self, client, auth_headers, db_session):
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={
                "provider": "anthropic",
                "model": "claude-sonnet-5",
                "api_key": "sk-ant-a-real-looking-key",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "anthropic"
        assert data["base_url"] == "https://api.anthropic.com/v1/"
        assert data["model"] == "claude-sonnet-5"
        # Stored encrypted, never in the clear.
        user = db_session.query(User).filter_by(username="testuser").one()
        assert "sk-ant-a-real-looking-key" not in (user.llm_api_key_encrypted or "")

    def test_switching_provider_without_a_key_is_rejected(self, client, auth_headers):
        """One vendor's credential must never be presented to another."""
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={"provider": "anthropic", "model": "claude-sonnet-5"},
        )

        assert resp.status_code == 422
        assert "API key" in resp.json()["detail"]

    def test_omitting_the_key_keeps_the_stored_one(self, client, auth_headers):
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={"provider": "openai", "model": "gpt-4o"},
        )

        assert resp.status_code == 200
        assert resp.json()["has_api_key"] is True
        assert resp.json()["model"] == "gpt-4o"

    def test_clearing_a_required_key_is_rejected(self, client, auth_headers, db_session):
        """Blanking the key of a provider that needs one would leave a
        half-configured connection; disconnecting is the DELETE route."""
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={"provider": "openai", "model": "gpt-4o", "api_key": ""},
        )

        assert resp.status_code == 422
        assert "API key" in resp.json()["detail"]
        # The stored key survives a rejected update.
        user = db_session.query(User).filter_by(username="testuser").one()
        assert user.llm_api_key_encrypted is not None

    def test_empty_key_clears_the_stored_one_for_a_keyless_provider(
        self, client, auth_headers, db_session, allow_private_llm_urls
    ):
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={
                "provider": "ollama",
                "model": "llama3",
                "base_url": "http://localhost:11434/v1",
                "api_key": "",
            },
        )

        assert resp.status_code == 200
        assert resp.json()["has_api_key"] is False
        user = db_session.query(User).filter_by(username="testuser").one()
        assert user.llm_api_key_encrypted is None

    def test_self_hosted_provider_needs_no_key(self, client, auth_headers, allow_private_llm_urls):
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={
                "provider": "ollama",
                "model": "llama3",
                "base_url": "http://localhost:11434/v1",
                "api_key": "",
            },
        )

        assert resp.status_code == 200
        assert resp.json()["configured"] is True
        assert resp.json()["has_api_key"] is False

    def test_custom_provider_requires_a_base_url(self, client, auth_headers):
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={"provider": "custom", "model": "some-model", "api_key": ""},
        )

        assert resp.status_code == 422
        assert "base URL" in resp.json()["detail"]

    def test_rejects_an_unknown_provider(self, client, auth_headers):
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={"provider": "not-a-vendor", "model": "m", "api_key": "k"},
        )

        assert resp.status_code == 422
        assert "Unknown provider" in resp.json()["detail"]

    def test_rejects_a_non_http_base_url(self, client, auth_headers):
        """Base URLs become server-side request targets, so the scheme is
        validated at the boundary — see SECURITY.md."""
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={
                "provider": "custom",
                "model": "m",
                "base_url": "file:///etc/passwd",
                "api_key": "",
            },
        )

        assert resp.status_code == 422
        assert "http://" in resp.json()["detail"]

    def test_rejects_a_base_url_with_embedded_credentials(self, client, auth_headers):
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={
                "provider": "custom",
                "model": "m",
                "base_url": "https://user:pass@gateway.example/v1",
                "api_key": "",
            },
        )

        assert resp.status_code == 422
        assert "username or password" in resp.json()["detail"]

    def test_rejects_a_blank_model(self, client, auth_headers):
        resp = client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={"provider": "openai", "model": "   "},
        )

        assert resp.status_code == 422
        assert "Model is required" in resp.json()["detail"]

    def test_connections_are_per_user(self, client, auth_headers, second_auth_headers):
        client.put(
            "/api/auth/me/llm-connection",
            headers=second_auth_headers,
            json={
                "provider": "gemini",
                "model": "gemini-3.6-flash",
                "api_key": "AIza-second-user-key",
            },
        )

        mine = client.get("/api/auth/me/llm-connection", headers=auth_headers).json()
        theirs = client.get("/api/auth/me/llm-connection", headers=second_auth_headers).json()

        assert mine["provider"] == "openai"
        assert theirs["provider"] == "gemini"


class TestDeleteConnection:
    def test_erases_provider_and_key(self, client, auth_headers, db_session):
        resp = client.delete("/api/auth/me/llm-connection", headers=auth_headers)

        assert resp.status_code == 200
        assert resp.json()["configured"] is False
        user = db_session.query(User).filter_by(username="testuser").one()
        assert user.llm_provider is None
        assert user.llm_api_key_encrypted is None


class TestConnectionProbe:
    def test_reports_success_naming_provider_and_model(self, client, auth_headers, mock_llm):
        mock_llm.return_value.chat.completions.create.return_value = make_chat_response("ok")

        resp = client.post("/api/auth/me/llm-connection/test", headers=auth_headers)

        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert "OpenAI" in resp.json()["message"]
        assert TEST_LLM_MODEL in resp.json()["message"]

    def test_reports_a_rejected_key_inline_rather_than_erroring(
        self, client, auth_headers, mock_llm
    ):
        mock_llm.return_value.chat.completions.create.side_effect = AuthenticationError(
            message="bad key",
            response=HttpxResponse(401, request=HttpxRequest("POST", "https://api.openai.com")),
            body=None,
        )

        resp = client.post("/api/auth/me/llm-connection/test", headers=auth_headers)

        # 200 with ok=false, so the form can render it beside the key field.
        assert resp.status_code == 200
        assert resp.json()["ok"] is False
        assert "API key" in resp.json()["message"]

    def test_reports_failure_when_no_provider_is_connected(self, client, auth_headers):
        client.delete("/api/auth/me/llm-connection", headers=auth_headers)

        resp = client.post("/api/auth/me/llm-connection/test", headers=auth_headers)

        assert resp.status_code == 200
        assert resp.json()["ok"] is False
        assert "Settings" in resp.json()["message"]

    def test_probe_is_recorded_in_the_spend_ledger(
        self, client, auth_headers, mock_llm, db_session
    ):
        """Regression test for the budget finding: the connection test made a
        real billed call while skipping the ledger entirely, so its usage was
        invisible to the Dashboard and to every subsequent ceiling check."""
        from app.models.billed_call import BilledCall

        mock_llm.return_value.chat.completions.create.return_value = make_chat_response("ok")

        resp = client.post("/api/auth/me/llm-connection/test", headers=auth_headers)
        assert resp.json()["ok"] is True

        rows = db_session.query(BilledCall).filter_by(source="connection_test").all()
        assert len(rows) == 1

    def test_probe_is_refused_once_a_ceiling_is_exhausted(
        self, client, auth_headers, mock_llm, monkeypatch
    ):
        """It was the one endpoint that kept spending after the budget ran out."""
        monkeypatch.setenv("USER_MONTHLY_BUDGET_USD", "0.0000001")
        mock_llm.return_value.chat.completions.create.return_value = make_chat_response("ok")

        # Spend something so recorded spend is at the ceiling.
        client.post("/api/auth/me/llm-connection/test", headers=auth_headers)
        resp = client.post("/api/auth/me/llm-connection/test", headers=auth_headers)

        assert resp.status_code == 200
        assert resp.json()["ok"] is False
        assert "budget" in resp.json()["message"].lower()

    def test_probe_response_never_contains_the_key(self, client, auth_headers, mock_llm):
        mock_llm.return_value.chat.completions.create.return_value = make_chat_response("ok")

        resp = client.post("/api/auth/me/llm-connection/test", headers=auth_headers)

        assert TEST_LLM_API_KEY not in resp.text


class TestPerUserProviderIsolation:
    def test_each_users_call_goes_to_their_own_provider(
        self, client, auth_headers, second_auth_headers, mock_llm, db_session
    ):
        """End-to-end proof of the core guarantee: two users configured with
        different providers each drive their own endpoint, on their own key,
        and are billed under their own provider."""
        client.put(
            "/api/auth/me/llm-connection",
            headers=second_auth_headers,
            json={
                "provider": "anthropic",
                "model": "claude-sonnet-5",
                "api_key": "sk-ant-second-user-key",
            },
        )
        mock_llm.return_value.chat.completions.create.return_value = make_chat_response(
            '{"fields": [{"name": "goal", "content": "x"}]}'
        )

        first = client.post("/api/prompts/parse-text", headers=auth_headers, json={"text": "hello"})
        first_kwargs = mock_llm.call_args.kwargs
        second = client.post(
            "/api/prompts/parse-text", headers=second_auth_headers, json={"text": "hello"}
        )
        second_kwargs = mock_llm.call_args.kwargs

        assert first.status_code == 200
        assert second.status_code == 200
        assert first_kwargs["api_key"] == TEST_LLM_API_KEY
        assert first_kwargs["base_url"] == "https://api.openai.com/v1"
        assert second_kwargs["api_key"] == "sk-ant-second-user-key"
        assert second_kwargs["base_url"] == "https://api.anthropic.com/v1/"

        billed_providers = sorted(row.provider for row in db_session.query(BilledCall).all())
        assert billed_providers == ["anthropic", "openai"]


class TestKeyNeverLeaks:
    def test_no_endpoint_echoes_the_stored_key(self, client, auth_headers, mock_llm):
        """Sweep every user-facing surface that touches the connection."""
        mock_llm.return_value.chat.completions.create.return_value = make_chat_response("ok")

        responses = [
            client.get("/api/auth/me", headers=auth_headers),
            client.get("/api/auth/me/llm-connection", headers=auth_headers),
            client.get("/api/prompts/config", headers=auth_headers),
            client.post("/api/auth/me/llm-connection/test", headers=auth_headers),
            client.put(
                "/api/auth/me/llm-connection",
                headers=auth_headers,
                json={"provider": "openai", "model": TEST_LLM_MODEL},
            ),
        ]

        for resp in responses:
            assert TEST_LLM_API_KEY not in resp.text

    def test_key_is_not_written_to_logs(self, client, auth_headers, caplog, mock_llm):
        mock_llm.return_value.chat.completions.create.side_effect = RuntimeError("upstream blew up")

        with caplog.at_level("DEBUG"):
            client.post("/api/auth/me/llm-connection/test", headers=auth_headers)
            with patch("app.api.routes.TextParserService.parse", side_effect=RuntimeError("boom")):
                client.post("/api/prompts/parse-text", headers=auth_headers, json={"text": "hello"})

        assert TEST_LLM_API_KEY not in caplog.text
