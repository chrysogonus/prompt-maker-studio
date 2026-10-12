"""
Tests for Settings preferences (PATCH /api/auth/me) and GET /api/prompts/export.
"""

from sqlalchemy import event
from sqlalchemy.engine import Engine

from app.models.prompt import Prompt


class TestUserPreferences:
    def test_defaults_are_off_and_unset(self, client, auth_headers):
        me = client.get("/api/auth/me", headers=auth_headers).json()
        assert "default_model" not in me  # superseded by the provider connection
        assert "notify_run_failure" not in me  # email notifications were retired
        assert me["default_library_view"] is None
        assert me["default_eval_method"] is None
        assert me["auto_run_eval_on_update"] is False

    def test_patch_sets_eval_and_library_preferences(self, client, auth_headers):
        resp = client.patch(
            "/api/auth/me",
            headers=auth_headers,
            json={
                "default_library_view": "list",
                "default_eval_method": "judge",
                "auto_run_eval_on_update": True,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["default_library_view"] == "list"
        assert data["default_eval_method"] == "judge"
        assert data["auto_run_eval_on_update"] is True

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

    def test_preferences_persist_across_requests(self, client, auth_headers):
        client.patch(
            "/api/auth/me",
            headers=auth_headers,
            json={"default_library_view": "grid", "default_eval_method": "judge"},
        )
        me = client.get("/api/auth/me", headers=auth_headers).json()
        assert me["default_eval_method"] == "judge"
        assert me["default_library_view"] == "grid"


class TestExportEndpoint:
    def test_export_empty_when_no_prompts(self, client, auth_headers):
        resp = client.get("/api/prompts/export", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["prompts"] == []
        assert "exported_at" in data

    def test_export_includes_fields_folder_tags_and_versions(
        self, client, auth_headers, db_session
    ):
        create = client.post(
            "/api/prompts",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v1"}], "name": "Exportable"},
        )
        prompt_id = create.json()["id"]
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"folder": "Support", "fields": [{"name": "goal", "content": "v2"}]},
        )
        # Tags are no longer editable, but stored ones stay in the export.
        db_session.query(Prompt).filter(Prompt.id == prompt_id).update({Prompt.tags: ["a", "b"]})
        db_session.commit()

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
                "/api/prompts",
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
            "/api/prompts",
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
