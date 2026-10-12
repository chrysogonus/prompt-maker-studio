"""Tests for prompt version snapshotting and restore (migration 009)."""

import pytest

from app.models.prompt_version import PromptVersion


class TestPromptVersioning:
    """Tests for GET/POST /api/prompts/{id}/versions* endpoints."""

    def _create_saved_prompt(self, client, headers, name="Original") -> int:
        response = client.post(
            "/api/prompts",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "v1 content"}], "name": name},
        )
        assert response.status_code == 201
        return response.json()["id"]

    def test_no_versions_before_any_edit(self, client, auth_headers):
        """A freshly saved prompt has no version history yet."""
        prompt_id = self._create_saved_prompt(client, auth_headers)

        resp = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_save_note_belongs_to_result_and_survives_next_save(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        path = f"/api/prompts/{prompt_id}"
        updated = client.patch(
            path,
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v2"}], "note": "Shortened the task"},
        ).json()
        assert updated["current_note"] == "Shortened the task"
        assert client.get(path + "/versions", headers=auth_headers).json()[0]["note"] is None
        client.patch(
            path, headers=auth_headers, json={"fields": [{"name": "goal", "content": "v3"}]}
        )
        history = client.get(path + "/versions", headers=auth_headers).json()
        assert history[0]["note"] == "Shortened the task"
        assert history[0]["fields"][0]["content"] == "v2"
        assert client.get(path, headers=auth_headers).json()["current_note"] is None

    def test_variable_settings_are_versioned_and_restored(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        path = f"/api/prompts/{prompt_id}"
        settings = {"topic": {"type": "text", "required": True, "example": "Climate"}}
        client.patch(
            path,
            headers=auth_headers,
            json={"variable_metadata": settings, "note": "Require topic"},
        )
        saved = client.get(path, headers=auth_headers).json()
        assert saved["variable_metadata"]["topic"]["required"] is True
        assert saved["variable_metadata"]["topic"]["example"] == "Climate"
        first = client.get(path + "/versions", headers=auth_headers).json()[0]
        client.post(path + f"/versions/{first['id']}/restore", headers=auth_headers)
        assert client.get(path, headers=auth_headers).json()["variable_metadata"] == {}

    def test_legacy_variable_defaults_do_not_create_a_spurious_version(
        self, client, auth_headers, db_session
    ):
        from app.models.prompt import Prompt

        prompt_id = self._create_saved_prompt(client, auth_headers)
        row = db_session.query(Prompt).filter_by(id=prompt_id).one()
        row.variable_metadata = {"topic": {"type": "text", "description": "Subject"}}
        db_session.commit()
        path = f"/api/prompts/{prompt_id}"
        metadata = client.get(path, headers=auth_headers).json()["variable_metadata"]
        client.patch(path, headers=auth_headers, json={"variable_metadata": metadata})
        assert client.get(path + "/versions", headers=auth_headers).json() == []

    def test_editing_content_creates_a_version_of_the_prior_state(self, client, auth_headers):
        """Editing fields/generated_prompt on a saved prompt snapshots the old state."""
        prompt_id = self._create_saved_prompt(client, auth_headers)

        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "v2 content"}]},
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
            json={"fields": current["fields"]},
        )

        assert response.status_code == 200
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
        assert versions_after[0]["note"] is None
        assert resp.json()["current_note"] == "Restore to v1"

    @pytest.mark.parametrize(
        ("old_text", "restored_fields"),
        [
            # Hand-edited text still in the rendered shape splits into sections.
            (
                "<GOAL>\nedited by hand\n</GOAL>\n\n<TONE>\nwarm\n</TONE>",
                [
                    {"name": "goal", "content": "edited by hand"},
                    {"name": "tone", "content": "warm"},
                ],
            ),
            # Anything else is restored whole rather than guessed at.
            ("Free text, no tags", [{"name": "prompt", "content": "Free text, no tags"}]),
        ],
    )
    def test_restoring_a_version_whose_text_disagrees_with_its_fields(
        self, client, auth_headers, db_session, old_text, restored_fields
    ):
        """Versions from before sections became the source of the text can hold
        hand-edited text their stale fields don't render to. Restoring brings
        back that text, as sections that render to it."""
        prompt_id = self._create_saved_prompt(client, auth_headers)
        version = PromptVersion(
            prompt_id=prompt_id,
            version_number=1,
            fields=[{"name": "goal", "content": "stale"}],
            generated_prompt=old_text,
        )
        db_session.add(version)
        db_session.commit()

        resp = client.post(
            f"/api/prompts/{prompt_id}/versions/{version.id}/restore", headers=auth_headers
        )

        assert resp.status_code == 200
        assert resp.json()["fields"] == restored_fields
        if len(restored_fields) > 1:
            assert resp.json()["generated_prompt"] == old_text
        else:
            assert resp.json()["generated_prompt"] == f"<PROMPT>\n{old_text}\n</PROMPT>"

    def test_restore_nonexistent_version_returns_404(self, client, auth_headers):
        prompt_id = self._create_saved_prompt(client, auth_headers)
        resp = client.post(f"/api/prompts/{prompt_id}/versions/999/restore", headers=auth_headers)
        assert resp.status_code == 404

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
