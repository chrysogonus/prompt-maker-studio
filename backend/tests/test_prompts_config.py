"""Tests for GET /api/prompts/config — the calling user's AI capability state."""

from unittest.mock import patch

from tests.conftest import TEST_LLM_MODEL


class TestPromptsConfigEndpoint:
    """Test cases for the AI-capability config endpoint."""

    def test_config_reports_the_callers_own_connection(self, client, auth_headers):
        """A connected user gets their provider, model, and a populated picker."""
        response = client.get("/api/prompts/config", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["provider_connected"] is True
        assert data["provider"] == "openai"
        assert data["provider_label"] == "OpenAI"
        assert data["model"] == TEST_LLM_MODEL
        # The user's own model leads the picker.
        assert data["available_models"][0] == TEST_LLM_MODEL

    def test_config_reports_disconnected_when_no_provider_is_set(self, client, auth_headers):
        """With no connection, no models are advertised — the frontend must not
        offer a model it cannot actually run."""
        client.delete("/api/auth/me/llm-connection", headers=auth_headers)

        response = client.get("/api/prompts/config", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() == {
            "provider_connected": False,
            "provider": None,
            "provider_label": None,
            "model": None,
            "available_models": [],
            "budget_exhausted": False,
            "global_budget_remaining_usd": None,
        }

    def test_config_never_leaks_the_api_key(self, client, auth_headers):
        """The stored credential must not appear anywhere in the response."""
        from tests.conftest import TEST_LLM_API_KEY

        response = client.get("/api/prompts/config", headers=auth_headers)

        assert TEST_LLM_API_KEY not in response.text

    def test_config_requires_authentication(self, client):
        """Capability is now a per-user question, so the endpoint needs a token."""
        response = client.get("/api/prompts/config")

        assert response.status_code == 401

    def test_config_is_scoped_per_user(self, client, auth_headers, second_auth_headers):
        """One user disconnecting must not change what another user sees."""
        client.delete("/api/auth/me/llm-connection", headers=second_auth_headers)

        mine = client.get("/api/prompts/config", headers=auth_headers).json()
        theirs = client.get("/api/prompts/config", headers=second_auth_headers).json()

        assert mine["provider_connected"] is True
        assert theirs["provider_connected"] is False

    def test_config_reports_no_budget_ceiling_by_default(self, client, auth_headers):
        """Unset GLOBAL_MONTHLY_BUDGET_USD means unlimited — budgets are opt-in."""
        response = client.get("/api/prompts/config", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["budget_exhausted"] is False
        assert data["global_budget_remaining_usd"] is None

    @patch.dict("os.environ", {"GLOBAL_MONTHLY_BUDGET_USD": "10"}, clear=False)
    def test_config_reports_remaining_budget_when_configured(self, client, auth_headers):
        response = client.get("/api/prompts/config", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["budget_exhausted"] is False
        assert data["global_budget_remaining_usd"] == 10.0

    @patch.dict("os.environ", {"GLOBAL_MONTHLY_BUDGET_USD": "0"}, clear=False)
    def test_config_reports_exhausted_when_ceiling_is_zero(self, client, auth_headers):
        response = client.get("/api/prompts/config", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["budget_exhausted"] is True
        assert data["global_budget_remaining_usd"] == 0.0
