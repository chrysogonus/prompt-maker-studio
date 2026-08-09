"""Tests for prompt version snapshotting and restore (migration 009)."""

from app.models.playground_run import PlaygroundRun


class TestPromptVersioning:
    """Tests for GET/POST /api/prompts/{id}/versions* endpoints."""

    def _create_saved_prompt(self, client, headers, name="Original") -> int:
        response = client.post(
            "/api/prompts/generate",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "v1 content"}], "name": name},
        )
        assert response.status_code == 200
        return response.json()["id"]

    def test_no_versions_before_any_edit(self, client, auth_headers):
        """A freshly saved prompt has no version history yet."""
        prompt_id = self._create_saved_prompt(client, auth_headers)

        resp = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_editing_content_creates_a_version_of_the_prior_state(self, client, auth_headers):
        """Editing fields/generated_prompt on a saved prompt snapshots the old state."""
        prompt_id = self._create_saved_prompt(client, auth_headers)

        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={
                "fields": [{"name": "goal", "content": "v2 content"}],
                "generated_prompt": "<GOAL>v2 content</GOAL>",
            },
        )

        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        assert len(versions) == 1
        assert versions[0]["version_number"] == 1
        assert versions[0]["fields"][0]["content"] == "v1 content"

        # The live row now reflects the new content.
        current = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()
        assert current["fields"][0]["content"] == "v2 content"

    def test_renaming_only_does_not_create_a_version(self, client, auth_headers):
        """A PATCH that only changes the name shouldn't snapshot content."""
        prompt_id = self._create_saved_prompt(client, auth_headers)

        client.patch(f"/api/prompts/{prompt_id}", headers=auth_headers, json={"name": "Renamed"})

        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        assert versions == []

    def test_resaving_identical_content_does_not_create_a_version(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        current = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()

        response = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"generated_prompt": current["generated_prompt"]},
        )

        assert response.status_code == 200
        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        assert versions == []

    def test_editing_an_unnamed_prompt_does_not_create_a_version(self, client, auth_headers):
        """History-only (unnamed) prompts have no prior 'saved' state to preserve."""
        response = client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "draft"}]},
        )
        prompt_id = response.json()["id"]

        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "still a draft"}]},
        )

        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        assert versions == []

    def test_multiple_edits_increment_version_number(self, client, auth_headers):
        """Each successive content edit gets the next version number."""
        prompt_id = self._create_saved_prompt(client, auth_headers)

        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v2"}]},
        )
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v3"}]},
        )

        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        assert [v["version_number"] for v in versions] == [2, 1]

    def test_version_includes_author_username(self, client, auth_headers):
        """The version's author field reflects the user who made the superseded edit."""
        prompt_id = self._create_saved_prompt(client, auth_headers)
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v2"}]},
        )

        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        # auth_headers fixture registers "testuser" — see conftest.py
        assert versions[0]["author"] == "testuser"

    def test_versions_requires_auth(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.get(f"/api/prompts/{prompt_id}/versions")
        assert resp.status_code in (401, 403)

    def test_versions_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.get(f"/api/prompts/{prompt_id}/versions", headers=second_auth_headers)
        assert resp.status_code == 404

    def test_restore_reverts_content_and_snapshots_replaced_state(self, client, auth_headers):
        """Restoring an old version brings back its content and preserves the current one."""
        prompt_id = self._create_saved_prompt(client, auth_headers)
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v2 content"}]},
        )
        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        v1_id = versions[0]["id"]
        assert versions[0]["fields"][0]["content"] == "v1 content"

        resp = client.post(
            f"/api/prompts/{prompt_id}/versions/{v1_id}/restore", headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["fields"][0]["content"] == "v1 content"

        # The v2 state that was just replaced is now itself a version.
        versions_after = client.get(
            f"/api/prompts/{prompt_id}/versions", headers=auth_headers
        ).json()
        assert len(versions_after) == 2
        assert versions_after[0]["fields"][0]["content"] == "v2 content"
        assert versions_after[0]["note"] == "Restore to v1"

    def test_restore_nonexistent_version_returns_404(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.post(f"/api/prompts/{prompt_id}/versions/999/restore", headers=auth_headers)
        assert resp.status_code == 404

    def test_restore_response_includes_real_run_count(self, client, auth_headers, db_session):
        """The restored prompt's response reflects real Playground run counts, not a placeholder."""
        user_id = client.get("/api/auth/me", headers=auth_headers).json()["id"]
        prompt_id = self._create_saved_prompt(client, auth_headers)
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v2 content"}]},
        )
        db_session.add(PlaygroundRun(prompt_id=prompt_id, user_id=user_id, model="gpt-4o-mini"))
        db_session.add(PlaygroundRun(prompt_id=prompt_id, user_id=user_id, model="gpt-4o-mini"))
        db_session.commit()

        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        v1_id = versions[0]["id"]

        resp = client.post(
            f"/api/prompts/{prompt_id}/versions/{v1_id}/restore", headers=auth_headers
        )
        assert resp.json()["run_count"] == 2

    def test_restore_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v2"}]},
        )
        version_id = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()[
            0
        ]["id"]

        resp = client.post(
            f"/api/prompts/{prompt_id}/versions/{version_id}/restore", headers=second_auth_headers
        )
        assert resp.status_code == 404

    def test_deleting_prompt_cascades_versions(self, client, auth_headers, db_session):
        """Deleting a prompt also removes its version history (ORM cascade)."""
        from app.models.prompt_version import PromptVersion

        prompt_id = self._create_saved_prompt(client, auth_headers)
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v2"}]},
        )
        assert db_session.query(PromptVersion).filter_by(prompt_id=prompt_id).count() == 1

        client.delete(f"/api/prompts/{prompt_id}", headers=auth_headers)

        assert db_session.query(PromptVersion).filter_by(prompt_id=prompt_id).count() == 0
