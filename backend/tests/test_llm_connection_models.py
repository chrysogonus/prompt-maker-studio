"""Tests for the authenticated live provider-model catalogue endpoint."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services import llm_model_catalog


def _models(*model_ids: str) -> SimpleNamespace:
    return SimpleNamespace(data=[SimpleNamespace(id=model_id) for model_id in model_ids])


class TestLLMConnectionModels:
    def test_requires_authentication(self, client):
        response = client.get("/api/auth/me/llm-connection/models")

        assert response.status_code == 401

    def test_requires_a_configured_connection(self, client, auth_headers):
        client.delete("/api/auth/me/llm-connection", headers=auth_headers)

        response = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)

        assert response.status_code == 422
        assert "Settings" in response.json()["detail"]

    @pytest.mark.parametrize("provider", ["ollama", "vllm", "custom"])
    def test_lists_discovered_models_with_pricing(
        self, client, auth_headers, mock_llm, allow_private_llm_urls, provider
    ):
        self._connect(client, auth_headers, provider)
        mock_llm.return_value.models.list.return_value = _models("local-model", "new-model")
        response = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        assert response.status_code == 200
        # Custom gateways have unknown prices; self-hosted inference is free.
        price = None if provider == "custom" else 0.0
        assert response.json() == [
            {
                "id": "local-model",
                "label": None,
                "input_price_per_1m": price,
                "output_price_per_1m": price,
            },
            {
                "id": "new-model",
                "label": None,
                "input_price_per_1m": price,
                "output_price_per_1m": price,
            },
        ]

    def test_live_listing_is_cached_per_user(
        self, client, auth_headers, second_auth_headers, mock_llm, allow_private_llm_urls
    ):
        self._connect(client, auth_headers)
        self._connect(client, second_auth_headers)
        mock_llm.return_value.models.list.side_effect = [
            _models("alice-model"),
            _models("bob-model"),
        ]
        first = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        second = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        other = client.get("/api/auth/me/llm-connection/models", headers=second_auth_headers)
        assert first.json()[0]["id"] == second.json()[0]["id"] == "alice-model"
        assert other.json()[0]["id"] == "bob-model"

    def test_provider_failure_returns_empty_catalogue_for_manual_entry(
        self, client, auth_headers, mock_llm, allow_private_llm_urls
    ):
        self._connect(client, auth_headers)
        mock_llm.return_value.models.list.side_effect = RuntimeError("provider unavailable")
        response = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

    def test_invalidate_discards_a_cached_live_list(
        self, client, auth_headers, mock_llm, allow_private_llm_urls
    ):
        self._connect(client, auth_headers)
        mock_llm.return_value.models.list.side_effect = [
            _models("first-model"),
            _models("second-model"),
        ]
        first = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        cached = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        llm_model_catalog.invalidate_model_cache(1)
        refreshed = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        assert first.json()[0]["id"] == cached.json()[0]["id"] == "first-model"
        assert refreshed.json()[0]["id"] == "second-model"

    @staticmethod
    def _connect(client, headers, provider="ollama"):
        response = client.put(
            "/api/auth/me/llm-connection",
            headers=headers,
            json={
                "provider": provider,
                "model": "local-model",
                "base_url": "http://localhost:11434/v1",
                "api_key": "",
            },
        )
        assert response.status_code == 200

    def test_update_route_invalidates_the_callers_cache(self, client, auth_headers):
        with patch("app.services.accounts.connections.invalidate_model_cache") as invalidate:
            response = client.put(
                "/api/auth/me/llm-connection",
                headers=auth_headers,
                json={"provider": "openai", "model": "gpt-6.1-sol"},
            )

        assert response.status_code == 200
        invalidate.assert_called_once_with(1)

    def test_delete_route_invalidates_the_callers_cache(self, client, auth_headers):
        with patch("app.services.accounts.connections.invalidate_model_cache") as invalidate:
            response = client.delete("/api/auth/me/llm-connection", headers=auth_headers)

        assert response.status_code == 200
        invalidate.assert_called_once_with(1)
