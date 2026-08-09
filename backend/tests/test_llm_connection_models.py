"""Tests for the authenticated live provider-model catalogue endpoint."""

from types import SimpleNamespace
from unittest.mock import patch

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

    def test_lists_live_models_with_known_and_unknown_pricing(self, client, auth_headers, mock_llm):
        mock_llm.return_value.models.list.return_value = _models(
            "gpt-4o-mini",
            "gpt-new-without-price",
        )

        response = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() == [
            {
                "id": "gpt-4o-mini",
                "input_price_per_1m": 0.15,
                "output_price_per_1m": 0.6,
            },
            {
                "id": "gpt-new-without-price",
                "input_price_per_1m": None,
                "output_price_per_1m": None,
            },
        ]

    def test_live_listing_is_cached_per_user(self, client, auth_headers, mock_llm):
        mock_llm.return_value.models.list.return_value = _models("gpt-4o-mini")

        first = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        second = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)

        assert first.status_code == second.status_code == 200
        mock_llm.return_value.models.list.assert_called_once_with()

    def test_provider_failure_falls_back_to_static_suggestions(
        self, client, auth_headers, mock_llm
    ):
        mock_llm.return_value.models.list.side_effect = RuntimeError("provider unavailable")

        response = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)

        assert response.status_code == 200
        assert [item["id"] for item in response.json()] == [
            "gpt-4o-mini",
            "gpt-4.1-mini-2025-04-14",
            "gpt-4o",
        ]

    def test_anthropic_uses_unchanged_static_list_without_listing(
        self, client, auth_headers, mock_llm
    ):
        client.put(
            "/api/auth/me/llm-connection",
            headers=auth_headers,
            json={
                "provider": "anthropic",
                "model": "claude-sonnet-5",
                "api_key": "sk-ant-test-key",
            },
        )

        response = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)

        assert response.status_code == 200
        assert [item["id"] for item in response.json()] == [
            "claude-opus-5",
            "claude-sonnet-5",
            "claude-haiku-4-5-20251001",
        ]
        mock_llm.return_value.models.list.assert_not_called()

    def test_invalidate_discards_a_cached_live_list(self, client, auth_headers, mock_llm):
        mock_llm.return_value.models.list.side_effect = [
            _models("first-model"),
            _models("second-model"),
        ]

        first = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        cached = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
        llm_model_catalog.invalidate_model_cache(1)
        refreshed = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)

        assert first.json()[0]["id"] == "first-model"
        assert cached.json()[0]["id"] == "first-model"
        assert refreshed.json()[0]["id"] == "second-model"
        assert mock_llm.return_value.models.list.call_count == 2

    def test_update_route_invalidates_the_callers_cache(self, client, auth_headers):
        with patch("app.api.auth_routes.invalidate_model_cache") as invalidate:
            response = client.put(
                "/api/auth/me/llm-connection",
                headers=auth_headers,
                json={"provider": "openai", "model": "gpt-4o"},
            )

        assert response.status_code == 200
        invalidate.assert_called_once_with(1)

    def test_delete_route_invalidates_the_callers_cache(self, client, auth_headers):
        with patch("app.api.auth_routes.invalidate_model_cache") as invalidate:
            response = client.delete("/api/auth/me/llm-connection", headers=auth_headers)

        assert response.status_code == 200
        invalidate.assert_called_once_with(1)
