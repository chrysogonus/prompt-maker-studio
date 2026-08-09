"""Tests for business-metric counters incrementing on the relevant routes."""

from unittest.mock import patch

from openai import OpenAIError

from app.metrics import (
    ai_import_failures_total,
    ai_imports_total,
    login_successes_total,
    prompts_generated_total,
    prompts_saved_total,
    user_registrations_total,
)
from app.services.spend_ledger import LLMUsage


def _value(counter) -> float:
    """Read a counter's current total through prometheus_client's public API.

    `counter._value.get()` reaches into library internals that carry no
    compatibility guarantee. `collect()` yields the same samples the `/metrics`
    endpoint exposes, which is what these assertions actually mean.
    """
    (metric,) = counter.collect()
    return next(sample.value for sample in metric.samples if sample.name.endswith("_total"))


def test_generate_prompt_increments_prompts_generated_total(client, auth_headers):
    """A successful generate call increments prompts_generated_total."""
    before = _value(prompts_generated_total)

    client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "goal", "content": "x"}]},
        headers=auth_headers,
    )

    assert _value(prompts_generated_total) == before + 1


def test_generate_prompt_with_name_increments_prompts_saved_total(client, auth_headers):
    """Generating a prompt that is already named increments prompts_saved_total."""
    before = _value(prompts_saved_total)

    client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "goal", "content": "x"}], "name": "My Saved Prompt"},
        headers=auth_headers,
    )

    assert _value(prompts_saved_total) == before + 1


def test_generate_prompt_without_name_does_not_increment_prompts_saved_total(client, auth_headers):
    """Generating an unnamed prompt does not increment prompts_saved_total."""
    before = _value(prompts_saved_total)

    client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "goal", "content": "x"}]},
        headers=auth_headers,
    )

    assert _value(prompts_saved_total) == before


def test_update_prompt_naming_it_increments_prompts_saved_total(client, auth_headers):
    """Naming a previously-unnamed prompt via PATCH increments prompts_saved_total."""
    gen = client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "goal", "content": "x"}]},
        headers=auth_headers,
    )
    prompt_id = gen.json()["id"]

    before = _value(prompts_saved_total)
    client.patch(f"/api/prompts/{prompt_id}", json={"name": "Now Named"}, headers=auth_headers)

    assert _value(prompts_saved_total) == before + 1


def test_renaming_already_saved_prompt_does_not_double_count(client, auth_headers):
    """Renaming an already-saved prompt must not increment prompts_saved_total again."""
    gen = client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "goal", "content": "x"}], "name": "Original"},
        headers=auth_headers,
    )
    prompt_id = gen.json()["id"]

    before = _value(prompts_saved_total)
    client.patch(f"/api/prompts/{prompt_id}", json={"name": "Renamed"}, headers=auth_headers)

    assert _value(prompts_saved_total) == before


def test_parse_text_success_increments_ai_imports_total_only(client, auth_headers):
    """A successful parse-text call increments ai_imports_total but not the failure counter."""
    imports_before = _value(ai_imports_total)
    failures_before = _value(ai_import_failures_total)

    with patch(
        "app.api.routes.TextParserService.parse",
        return_value=(
            [],
            LLMUsage(provider="openai", model="gpt-4o-mini", prompt_tokens=1, completion_tokens=1),
        ),
    ):
        client.post("/api/prompts/parse-text", json={"text": "hi"}, headers=auth_headers)

    assert _value(ai_imports_total) == imports_before + 1
    assert _value(ai_import_failures_total) == failures_before


def test_parse_text_failure_increments_both_counters(client, auth_headers):
    """A failing parse-text call increments both the attempt and failure counters."""
    imports_before = _value(ai_imports_total)
    failures_before = _value(ai_import_failures_total)

    with patch("app.api.routes.TextParserService.parse", side_effect=OpenAIError("down")):
        client.post("/api/prompts/parse-text", json={"text": "hi"}, headers=auth_headers)

    assert _value(ai_imports_total) == imports_before + 1
    assert _value(ai_import_failures_total) == failures_before + 1


def test_register_increments_user_registrations_total(client):
    """A successful registration increments user_registrations_total."""
    before = _value(user_registrations_total)

    client.post(
        "/api/auth/register",
        json={"username": "metricsuser", "password": "testpass123", "email": "m@example.com"},
    )

    assert _value(user_registrations_total) == before + 1


def test_failed_register_does_not_increment_user_registrations_total(client):
    """A rejected (duplicate) registration does not increment the counter."""
    client.post(
        "/api/auth/register",
        json={"username": "dupmetrics", "password": "testpass123", "email": "d@example.com"},
    )

    before = _value(user_registrations_total)
    client.post(
        "/api/auth/register",
        json={"username": "dupmetrics", "password": "testpass123", "email": "d2@example.com"},
    )

    assert _value(user_registrations_total) == before


def test_login_increments_login_successes_total(client):
    """A successful login increments login_successes_total."""
    client.post(
        "/api/auth/register",
        json={"username": "loginmetrics", "password": "testpass123", "email": "l@example.com"},
    )

    before = _value(login_successes_total)
    client.post("/api/auth/login", json={"username": "loginmetrics", "password": "testpass123"})

    assert _value(login_successes_total) == before + 1


def test_failed_login_does_not_increment_login_successes_total(client):
    """A failed login attempt does not increment the counter."""
    before = _value(login_successes_total)

    client.post("/api/auth/login", json={"username": "nosuchuser", "password": "wrong"})

    assert _value(login_successes_total) == before
