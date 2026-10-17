"""Hosted model selection is curated without disabling saved legacy connections."""

import pytest

from app.models.user import User
from tests.conftest import make_chat_response


@pytest.mark.parametrize(
    ("provider", "models"),
    [
        ("openai", ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]),
        ("anthropic", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]),
        ("gemini", ["gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.5-flash-lite"]),
    ],
)
def test_catalogue_only_offers_curated_models(client, auth_headers, mock_llm, provider, models):
    saved = client.put(
        "/api/auth/me/llm-connection",
        headers=auth_headers,
        json={"provider": provider, "model": models[0], "api_key": "test-provider-key"},
    )
    assert saved.status_code == 200
    # Discovery must not be required, nor allowed to add other models.
    mock_llm.return_value.models.list.side_effect = AssertionError("unexpected discovery")
    response = client.get("/api/auth/me/llm-connection/models", headers=auth_headers)
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == models
    assert all(item["label"] for item in response.json())
    mock_llm.return_value.models.list.assert_not_called()


def test_choices_are_available_before_connecting(client, auth_headers):
    client.delete("/api/auth/me/llm-connection", headers=auth_headers)
    response = client.get("/api/auth/me/llm-connection", headers=auth_headers)
    openai = next(p for p in response.json()["providers"] if p["handle"] == "openai")
    assert openai["models"][1] == {
        "id": "gpt-6.1-sol",
        "label": "GPT-6.1 Sol",
        "input_price_per_1m": 2.0,
        "output_price_per_1m": 10.0,
    }
    assert openai["suggested_models"] == ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]


@pytest.mark.parametrize("provider", ["openai", "anthropic", "gemini"])
def test_unlisted_model_cannot_be_saved(client, auth_headers, db_session, provider):
    user = db_session.query(User).filter_by(username="testuser").one()
    before = (user.llm_provider, user.llm_model, user.llm_api_key_encrypted)
    response = client.put(
        "/api/auth/me/llm-connection",
        headers=auth_headers,
        json={"provider": provider, "model": "unlisted-model", "api_key": "new-key"},
    )
    assert response.status_code == 422
    assert "current model" in response.json()["detail"]
    db_session.refresh(user)
    assert (user.llm_provider, user.llm_model, user.llm_api_key_encrypted) == before


def test_legacy_model_runs_but_is_not_advertised(client, auth_headers, db_session, mock_llm):
    user = db_session.query(User).filter_by(username="testuser").one()
    user.llm_model = "gpt-4o"
    db_session.commit()
    mock_llm.return_value.chat.completions.create.return_value = make_chat_response("ok")

    response = client.post("/api/auth/me/llm-connection/test", headers=auth_headers)
    assert response.json()["ok"] is True
    assert mock_llm.return_value.chat.completions.create.call_args.kwargs["model"] == "gpt-4o"
    config = client.get("/api/prompts/config", headers=auth_headers).json()
    assert config["model"] == "gpt-4o"
    assert config["available_models"] == ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]

    rejected = client.put(
        "/api/auth/me/llm-connection",
        headers=auth_headers,
        json={"provider": "openai", "model": "gpt-4o"},
    )
    assert rejected.status_code == 422
    changed = client.put(
        "/api/auth/me/llm-connection",
        headers=auth_headers,
        json={"provider": "openai", "model": "gpt-6.1-sol"},
    )
    assert changed.status_code == 200
    assert changed.json()["model"] == "gpt-6.1-sol"
    assert changed.json()["has_api_key"] is True
