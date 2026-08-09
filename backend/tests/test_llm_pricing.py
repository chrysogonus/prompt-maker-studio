"""Tests for LiteLLM-backed pricing with static and stale-cache fallbacks."""

from unittest.mock import patch

from app.services import llm_pricing


def test_build_index_maps_public_providers_and_prefixed_model_ids():
    index = llm_pricing._build_index(
        {
            "gemini/gemini-test": {
                "litellm_provider": "gemini",
                "input_cost_per_token": 2e-7,
                "output_cost_per_token": 8e-7,
            },
            "gpt-test": {
                "litellm_provider": "openai",
                "input_cost_per_token": 1e-6,
                "output_cost_per_token": 2e-6,
            },
            "vertex_ai/gemini-test": {
                "litellm_provider": "vertex_ai",
                "input_cost_per_token": 99,
                "output_cost_per_token": 99,
            },
        }
    )

    assert index[("gemini", "gemini/gemini-test")] == {"input": 0.2, "output": 0.8}
    assert index[("gemini", "gemini-test")] == {"input": 0.2, "output": 0.8}
    assert index[("openai", "gpt-test")] == {"input": 1.0, "output": 2.0}
    assert ("gemini", "vertex_ai/gemini-test") not in index


def test_live_pricing_takes_priority_over_static_fallback(mock_litellm_pricing):
    mock_litellm_pricing.return_value = {
        "gpt-4o-mini": {
            "litellm_provider": "openai",
            "input_cost_per_token": 2e-7,
            "output_cost_per_token": 8e-7,
        }
    }

    assert llm_pricing.rates_for("openai", "gpt-4o-mini") == {
        "input": 0.2,
        "output": 0.8,
    }


def test_missing_live_pair_uses_static_then_unknown(mock_litellm_pricing):
    mock_litellm_pricing.return_value = {}

    assert llm_pricing.rates_for("openai", "gpt-4o") == {
        "input": 2.5,
        "output": 10.0,
    }
    assert llm_pricing.rates_for("openai", "not-priced") is None
    assert llm_pricing.cost_usd_for("openai", "not-priced", 100, 100) == 0.0


def test_self_hosted_pricing_is_always_free_without_fetch(mock_litellm_pricing):
    assert llm_pricing.rates_for("ollama", "anything") == {
        "input": 0.0,
        "output": 0.0,
    }
    mock_litellm_pricing.assert_not_called()


def test_failed_refresh_serves_stale_index_and_retries_next_call(mock_litellm_pricing, caplog):
    mock_litellm_pricing.return_value = {
        "gpt-stale": {
            "litellm_provider": "openai",
            "input_cost_per_token": 3e-7,
            "output_cost_per_token": 9e-7,
        }
    }
    assert llm_pricing.rates_for("openai", "gpt-stale") == {
        "input": 0.3,
        "output": 0.9,
    }

    llm_pricing._pricing_cache.expires_at = 0.0
    mock_litellm_pricing.side_effect = RuntimeError("offline")
    with caplog.at_level("WARNING"):
        first_stale = llm_pricing.rates_for("openai", "gpt-stale")
        second_stale = llm_pricing.rates_for("openai", "gpt-stale")

    assert first_stale == second_stale == {"input": 0.3, "output": 0.9}
    assert mock_litellm_pricing.call_count == 3
    assert llm_pricing._pricing_cache.expires_at == 0.0
    assert "serving stale data" in caplog.text


def test_malformed_prices_are_not_indexed():
    with patch.object(llm_pricing, "_fetch_pricing_json", return_value={}):
        index = llm_pricing._build_index(
            {
                "missing-output": {
                    "litellm_provider": "openai",
                    "input_cost_per_token": 1e-7,
                },
                "negative": {
                    "litellm_provider": "openai",
                    "input_cost_per_token": -1,
                    "output_cost_per_token": 1,
                },
            }
        )

    assert index == {}


class TestOutboundPricingControls:
    """Regression tests for "default runtime/build behavior makes unconfigurable
    third-party outbound calls". The pricing index was fetched from a mutable
    `main` URL with no operator switch, and that response feeds both displayed
    spend and — when a ceiling is configured — budget accounting."""

    def test_the_source_revision_is_pinned_not_a_branch(self):
        from app.services.llm_pricing import pricing_source_url

        url = pricing_source_url()
        assert "/main/" not in url, "pricing must not be read from a mutable branch"
        assert "/v1." in url

    def test_refresh_can_be_disabled(self, monkeypatch):
        """With it off, nothing reaches the network: the fetch site must not even
        be called, and pricing falls back to the compiled-in snapshot."""
        from app.services import llm_pricing

        monkeypatch.setenv("LLM_PRICING_REFRESH", "false")
        llm_pricing._reset_pricing_cache()

        calls = []
        monkeypatch.setattr(llm_pricing, "_fetch_pricing_json", lambda: calls.append(1) or {})

        # A pair only the static fallback knows still resolves.
        assert llm_pricing.rates_for("openai", "gpt-4o-mini") is not None
        assert calls == []

    def test_refresh_is_enabled_by_default(self, monkeypatch):
        from app.services.llm_pricing import pricing_refresh_enabled

        monkeypatch.delenv("LLM_PRICING_REFRESH", raising=False)
        assert pricing_refresh_enabled() is True

    def test_the_url_can_point_at_a_mirror(self, monkeypatch):
        from app.services.llm_pricing import pricing_source_url

        monkeypatch.setenv("LLM_PRICING_URL", "https://mirror.internal/prices.json")
        assert pricing_source_url() == "https://mirror.internal/prices.json"
