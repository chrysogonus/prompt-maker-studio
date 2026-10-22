"""Tests for the unauthenticated public-tool endpoints under /api/public."""

from app.services.llm_providers import PROVIDERS


def test_model_prices_need_no_session(client):
    resp = client.get("/api/public/model-prices")

    assert resp.status_code == 200
    prices = resp.json()
    hosted = {handle for handle, provider in PROVIDERS.items() if provider.models}
    assert {row["provider"] for row in prices} == hosted
    luna = next(row for row in prices if row["id"] == "gpt-6-luna")
    assert luna["provider_label"] == "OpenAI"
    assert luna["label"] == "GPT-6 Luna"
    assert set(luna) == {
        "id",
        "label",
        "provider",
        "provider_label",
        "input_price_per_1m",
        "output_price_per_1m",
    }


def test_model_prices_list_only_curated_hosted_models(client):
    rows = client.get("/api/public/model-prices").json()

    for row in rows:
        assert row["id"] in PROVIDERS[row["provider"]].models
