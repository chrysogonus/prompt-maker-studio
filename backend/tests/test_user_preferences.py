"""
Tests for Settings preferences (PATCH /api/auth/me), the Playground
run-failure email hook, and GET /api/prompts/export.
"""

from unittest.mock import patch

from openai import OpenAIError
from sqlalchemy import event
from sqlalchemy.engine import Engine


class TestUserPreferences:
    def test_defaults_are_off_and_unset(self, client, auth_headers):
        me = client.get("/api/auth/me", headers=auth_headers).json()
        assert "default_model" not in me  # superseded by the provider connection
        assert me["notify_run_failure"] is False
        assert me["notify_weekly_summary"] is False
        assert me["default_library_view"] is None
        assert me["default_eval_method"] is None
        assert me["auto_run_eval_on_update"] is False
        assert me["notify_eval_complete"] is False
        assert me["notify_eval_regression"] is False

    def test_patch_sets_eval_and_library_preferences(self, client, auth_headers):
        resp = client.patch(
            "/api/auth/me",
            headers=auth_headers,
            json={
                "default_library_view": "list",
                "default_eval_method": "judge",
                "auto_run_eval_on_update": True,
                "notify_eval_complete": True,
                "notify_eval_regression": True,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["default_library_view"] == "list"
        assert data["default_eval_method"] == "judge"
        assert data["auto_run_eval_on_update"] is True
        assert data["notify_eval_complete"] is True
        assert data["notify_eval_regression"] is True

    def test_patch_rejects_invalid_default_library_view(self, client, auth_headers):
        resp = client.patch(
            "/api/auth/me", headers=auth_headers, json={"default_library_view": "carousel"}
        )
        assert resp.status_code == 422

    def test_patch_rejects_invalid_default_eval_method(self, client, auth_headers):
        resp = client.patch(
            "/api/auth/me", headers=auth_headers, json={"default_eval_method": "vibes"}
        )
        assert resp.status_code == 422

    def test_eval_preferences_persist_across_requests(self, client, auth_headers):
        client.patch(
            "/api/auth/me",
            headers=auth_headers,
            json={"default_eval_method": "manual", "auto_run_eval_on_update": True},
        )
        me = client.get("/api/auth/me", headers=auth_headers).json()
        assert me["default_eval_method"] == "manual"
        assert me["auto_run_eval_on_update"] is True

    def test_profile_no_longer_carries_a_model_preference(self, client, auth_headers):
        """The model lives on the provider connection now, so a stray
        `default_model` in a profile PATCH is ignored rather than stored."""
        resp = client.patch(
            "/api/auth/me", headers=auth_headers, json={"default_model": "gpt-4o-mini"}
        )
        assert resp.status_code == 200
        assert "default_model" not in resp.json()

    def test_patch_toggles_notification_preferences_independently(self, client, auth_headers):
        resp = client.patch("/api/auth/me", headers=auth_headers, json={"notify_run_failure": True})
        data = resp.json()
        assert data["notify_run_failure"] is True
        assert data["notify_weekly_summary"] is False

        resp = client.patch(
            "/api/auth/me", headers=auth_headers, json={"notify_weekly_summary": True}
        )
        data = resp.json()
        assert data["notify_run_failure"] is True
        assert data["notify_weekly_summary"] is True

    def test_preferences_persist_across_requests(self, client, auth_headers):
        client.patch(
            "/api/auth/me",
            headers=auth_headers,
            json={"notify_run_failure": True, "default_eval_method": "judge"},
        )
        me = client.get("/api/auth/me", headers=auth_headers).json()
        assert me["default_eval_method"] == "judge"
        assert me["notify_run_failure"] is True


class TestRunFailureEmailHook:
    def _create_saved_prompt(self, client, headers) -> int:
        resp = client.post(
            "/api/prompts/generate",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "x"}], "name": "Notify Me"},
        )
        return resp.json()["id"]

    def test_sends_email_when_opted_in_and_email_on_file(self, client, auth_headers):
        client.patch(
            "/api/auth/me",
            headers=auth_headers,
            json={"notify_run_failure": True, "email": "testuser@example.com"},
        )
        prompt_id = self._create_saved_prompt(client, auth_headers)

        with (
            patch("app.services.llm_client.OpenAI") as mock_openai_cls,
            patch("app.api.routes.send_playground_run_failure_email") as mock_send,
        ):
            mock_openai_cls.return_value.chat.completions.create.side_effect = OpenAIError("boom")
            resp = client.post(
                f"/api/prompts/{prompt_id}/playground/run",
                headers=auth_headers,
                json={"model": "gpt-4o-mini", "variables": {}},
            )

        assert resp.status_code == 502
        mock_send.assert_called_once()
        assert mock_send.call_args[0][0] == "testuser@example.com"
        assert mock_send.call_args[0][1] == "Notify Me"

    def test_does_not_send_email_when_not_opted_in(self, client, auth_headers):
        client.patch("/api/auth/me", headers=auth_headers, json={"email": "testuser@example.com"})
        prompt_id = self._create_saved_prompt(client, auth_headers)

        with (
            patch("app.services.llm_client.OpenAI") as mock_openai_cls,
            patch("app.api.routes.send_playground_run_failure_email") as mock_send,
        ):
            mock_openai_cls.return_value.chat.completions.create.side_effect = OpenAIError("boom")
            client.post(
                f"/api/prompts/{prompt_id}/playground/run",
                headers=auth_headers,
                json={"model": "gpt-4o-mini", "variables": {}},
            )

        mock_send.assert_not_called()

    def test_run_still_fails_with_502_even_if_email_send_itself_errors(self, client, auth_headers):
        """A broken SMTP config must not turn a 502 into a 500."""
        client.patch(
            "/api/auth/me",
            headers=auth_headers,
            json={"notify_run_failure": True, "email": "testuser@example.com"},
        )
        prompt_id = self._create_saved_prompt(client, auth_headers)

        with (
            patch("app.services.llm_client.OpenAI") as mock_openai_cls,
            patch(
                "app.api.routes.send_playground_run_failure_email",
                side_effect=RuntimeError("SMTP not configured"),
            ),
        ):
            mock_openai_cls.return_value.chat.completions.create.side_effect = OpenAIError("boom")
            resp = client.post(
                f"/api/prompts/{prompt_id}/playground/run",
                headers=auth_headers,
                json={"model": "gpt-4o-mini", "variables": {}},
            )

        assert resp.status_code == 502


class TestExportEndpoint:
    def test_export_empty_when_no_prompts(self, client, auth_headers):
        resp = client.get("/api/prompts/export", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["prompts"] == []
        assert "exported_at" in data

    def test_export_includes_fields_folder_tags_and_versions(self, client, auth_headers):
        create = client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v1"}], "name": "Exportable"},
        )
        prompt_id = create.json()["id"]
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={
                "folder": "Support",
                "tags": ["a", "b"],
                "fields": [{"name": "goal", "content": "v2"}],
            },
        )

        data = client.get("/api/prompts/export", headers=auth_headers).json()

        assert len(data["prompts"]) == 1
        exported = data["prompts"][0]
        assert exported["name"] == "Exportable"
        assert exported["folder"] == "Support"
        assert exported["tags"] == ["a", "b"]
        assert exported["fields"][0]["content"] == "v2"
        assert len(exported["versions"]) == 1
        assert exported["versions"][0]["fields"][0]["content"] == "v1"

    def test_export_requires_auth(self, client):
        resp = client.get("/api/prompts/export")
        assert resp.status_code in (401, 403)

    def test_export_does_not_n_plus_one_query_versions(self, client, auth_headers):
        """Regression test for Medium (Performance): export_prompts previously
        issued one PromptVersion query per prompt inside a loop. Asserts the
        version-fetching query count stays constant (batched) regardless of
        how many prompts have version history."""
        for i in range(4):
            create = client.post(
                "/api/prompts/generate",
                headers=auth_headers,
                json={"fields": [{"name": "goal", "content": "v1"}], "name": f"Exportable {i}"},
            )
            client.patch(
                f"/api/prompts/{create.json()['id']}",
                headers=auth_headers,
                json={"fields": [{"name": "goal", "content": "v2"}]},
            )

        version_query_count = 0

        def _count_version_queries(conn, cursor, statement, parameters, context, executemany):
            nonlocal version_query_count
            if "prompt_versions" in statement:
                version_query_count += 1

        event.listen(Engine, "before_cursor_execute", _count_version_queries)
        try:
            resp = client.get("/api/prompts/export", headers=auth_headers)
        finally:
            event.remove(Engine, "before_cursor_execute", _count_version_queries)

        assert resp.status_code == 200
        assert len(resp.json()["prompts"]) == 4
        assert version_query_count == 1

    def test_export_scoped_to_owner(self, client, auth_headers, second_auth_headers):
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "mine"}], "name": "Mine"},
        )
        data = client.get("/api/prompts/export", headers=second_auth_headers).json()
        assert data["prompts"] == []

    def test_export_is_rate_limited(self, client, auth_headers, monkeypatch):
        """Regression test for Low (Data Handling): unthrottled repeated calls
        to the full-data export endpoint were previously possible."""
        monkeypatch.setenv("TESTING", "false")

        for _ in range(10):
            resp = client.get("/api/prompts/export", headers=auth_headers)
            assert resp.status_code == 200

        resp = client.get("/api/prompts/export", headers=auth_headers)
        assert resp.status_code == 429
