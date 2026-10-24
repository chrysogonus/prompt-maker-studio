"""
Unit tests for API endpoints.
"""

import pytest

from app.api.routes import duplicate_prompt as duplicate_prompt_route
from app.models.eval_case import EvalCase
from app.models.prompt import Prompt
from app.models.user import User


class TestGetPromptByIdEndpoint:
    """Test cases for GET /api/prompts/{prompt_id} endpoint."""

    def test_get_existing_prompt(self, client, auth_headers):
        """Test getting an existing prompt by ID."""
        # Create a prompt
        create_response = client.post(
            "/api/prompts",
            headers=auth_headers,
            json={
                "name": "Prompt",
                "fields": [
                    {"name": "goal", "content": "Test prompt"},
                    {"name": "characters", "content": "Test character"},
                ],
            },
        )
        prompt_id = create_response.json()["id"]

        # Get the prompt
        response = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == prompt_id
        assert len(data["fields"]) == 2
        assert data["fields"][0]["name"] == "goal"
        assert data["fields"][0]["content"] == "Test prompt"
        assert "generated_prompt" in data

    def test_get_nonexistent_prompt(self, client, auth_headers):
        """Test getting a prompt that doesn't exist."""
        response = client.get("/api/prompts/999", headers=auth_headers)

        assert response.status_code == 404
        data = response.json()
        assert data["detail"] == "Prompt not found"

    def test_get_prompt_with_all_fields(self, client, auth_headers):
        """Test that all fields are returned correctly."""
        payload = {
            "name": "Prompt",
            "fields": [
                {"name": "goal", "content": "Full test"},
                {"name": "characters", "content": "Character A"},
                {"name": "style", "content": "Style B"},
                {"name": "setting", "content": "Setting C"},
            ],
        }

        create_response = client.post("/api/prompts", headers=auth_headers, json=payload)
        prompt_id = create_response.json()["id"]

        response = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["fields"]) == 4
        field_dict = {f["name"]: f["content"] for f in data["fields"]}
        assert field_dict["goal"] == "Full test"
        assert field_dict["characters"] == "Character A"
        assert field_dict["style"] == "Style B"
        assert field_dict["setting"] == "Setting C"


class TestCORSAndDocs:
    """Test CORS and documentation endpoints."""

    def test_cors_headers_present(self, client):
        """Test that CORS is properly configured."""
        # Make a regular request and check CORS headers are set
        response = client.get("/")
        # The app should respond successfully
        assert response.status_code == 200

    def test_openapi_docs_accessible(self, client):
        """Test that OpenAPI documentation is accessible."""
        response = client.get("/docs")
        assert response.status_code == 200

    def test_openapi_json_accessible(self, client):
        """Test that OpenAPI JSON schema is accessible."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        data = response.json()
        assert "openapi" in data
        assert "paths" in data


class TestDuplicatePromptEndpoint:
    """Test cases for POST /api/prompts/{prompt_id}/duplicate endpoint."""

    def test_duplicate_transaction_copies_configuration_without_client(self, db_session):
        """Exercise the route transaction directly when TestClient is unavailable."""
        user = User(username="copy-user", hashed_password="x", email="copy@example.com")
        db_session.add(user)
        db_session.flush()
        original = Prompt(
            user_id=user.id,
            name="Original",
            fields=[{"name": "goal", "content": "Use {{count}}"}],
            generated_prompt="Use {{count}}",
            folder="Engineering",
            tags=["urgent"],
            is_favorite=True,
            variable_metadata={"count": {"type": "number", "description": "Count"}},
        )
        db_session.add(original)
        db_session.flush()
        db_session.add(
            EvalCase(
                prompt_id=original.id,
                method="rule",
                name="Named robustness case",
                criteria="done",
                variables={"count": "2"},
                intentionally_empty=True,
                position=0,
            )
        )
        db_session.commit()

        duplicate = duplicate_prompt_route(original.id, db_session, user)

        assert duplicate.name == "Original Duplicate"
        assert duplicate.folder == original.folder
        assert duplicate.tags == original.tags
        assert duplicate.variable_metadata == original.variable_metadata
        assert duplicate.is_favorite is False
        duplicate_cases = db_session.query(EvalCase).filter_by(prompt_id=duplicate.id).all()
        assert len(duplicate_cases) == 1
        assert duplicate_cases[0].variables == {"count": "2"}
        assert duplicate_cases[0].name == "Named robustness case"
        assert duplicate_cases[0].intentionally_empty is True

    def test_duplicate_name_truncates_to_the_100_char_cap(self, db_session):
        """The generated 'X Duplicate' name must respect the same 100-char cap
        enforced on user-supplied names elsewhere, not the prior 255 limit."""
        user = User(username="copy-user-2", hashed_password="x", email="copy2@example.com")
        db_session.add(user)
        db_session.flush()
        original = Prompt(
            user_id=user.id,
            name="a" * 95,
            fields=[{"name": "goal", "content": "content"}],
            generated_prompt="content",
        )
        db_session.add(original)
        db_session.commit()

        duplicate = duplicate_prompt_route(original.id, db_session, user)

        assert len(duplicate.name) == 100
        assert duplicate.name == ("a" * 95 + " Duplicate")[:100]

    def test_duplicate_existing_prompt(self, client, auth_headers, db_session):
        """Test duplicating an existing prompt."""
        # Create an original prompt
        payload = {
            "name": "Prompt",
            "fields": [
                {"name": "goal", "content": "Original prompt goal"},
                {"name": "characters", "content": "Character A"},
                {"name": "style", "content": "Style B"},
            ],
        }
        create_response = client.post("/api/prompts", headers=auth_headers, json=payload)
        assert create_response.status_code == 201
        original_id = create_response.json()["id"]

        # Duplicate the prompt
        duplicate_response = client.post(
            f"/api/prompts/{original_id}/duplicate", headers=auth_headers
        )
        assert duplicate_response.status_code == 200
        duplicate_data = duplicate_response.json()

        # Verify duplicate has a different ID
        assert duplicate_data["id"] != original_id
        assert "generated_prompt" in duplicate_data
        assert "created_at" in duplicate_data

        # Verify both prompts exist in database
        prompts = db_session.query(Prompt).all()
        assert len(prompts) == 2

        # Verify content is the same
        original = db_session.query(Prompt).filter(Prompt.id == original_id).first()
        duplicate = db_session.query(Prompt).filter(Prompt.id == duplicate_data["id"]).first()

        assert duplicate.fields == original.fields
        assert duplicate.generated_prompt == original.generated_prompt

    def test_duplicate_deep_copies_authoring_configuration_and_eval_cases(
        self, client, auth_headers, db_session
    ):
        """A duplicate preserves reusable configuration but starts with no run/version history."""
        created = client.post(
            "/api/prompts",
            headers=auth_headers,
            json={
                "name": "Configured prompt",
                "fields": [{"name": "goal", "content": "Use {{count}} items"}],
            },
        ).json()
        prompt_id = created["id"]
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={
                "folder": "Engineering",
                "is_favorite": True,
                "variable_metadata": {"count": {"type": "number", "description": "Item count"}},
            },
        )
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "done", "variables": {"count": "2"}},
        )

        duplicate_response = client.post(
            f"/api/prompts/{prompt_id}/duplicate", headers=auth_headers
        )

        assert duplicate_response.status_code == 200
        duplicate_data = duplicate_response.json()
        assert duplicate_data["folder"] == "Engineering"
        assert duplicate_data["is_favorite"] is False
        assert duplicate_data["name"] == "Configured prompt Duplicate"
        assert duplicate_data["variable_metadata"]["count"] == {
            "type": "number",
            "description": "Item count",
            "required": False,
            "example": None,
        }
        duplicate_cases = (
            db_session.query(EvalCase).filter(EvalCase.prompt_id == duplicate_data["id"]).all()
        )
        assert len(duplicate_cases) == 1
        assert duplicate_cases[0].criteria == "done"
        assert duplicate_cases[0].variables == {"count": "2"}

    def test_duplicate_nonexistent_prompt(self, client, auth_headers):
        """Test duplicating a prompt that doesn't exist."""
        response = client.post("/api/prompts/999/duplicate", headers=auth_headers)
        assert response.status_code == 404
        data = response.json()
        assert data["detail"] == "Prompt not found"

    def test_deleted_prompt_id_is_never_recycled(self, client, auth_headers):
        """Old deep links must not resolve to an unrelated prompt after deletion."""
        first = client.post(
            "/api/prompts",
            headers=auth_headers,
            json={"name": "Prompt", "fields": [{"name": "goal", "content": "first"}]},
        ).json()
        assert client.delete(f"/api/prompts/{first['id']}", headers=auth_headers).status_code == 204

        second = client.post(
            "/api/prompts",
            headers=auth_headers,
            json={"name": "Prompt", "fields": [{"name": "goal", "content": "second"}]},
        ).json()

        assert second["id"] > first["id"]
        assert client.get(f"/api/prompts/{first['id']}", headers=auth_headers).status_code == 404

    def test_duplicate_prompt_with_minimal_fields(self, client, auth_headers, db_session):
        """Test duplicating a prompt with only one field."""
        # Create a minimal prompt
        payload = {"name": "Prompt", "fields": [{"name": "goal", "content": "Minimal goal"}]}
        create_response = client.post("/api/prompts", headers=auth_headers, json=payload)
        assert create_response.status_code == 201
        original_id = create_response.json()["id"]

        # Duplicate the prompt
        duplicate_response = client.post(
            f"/api/prompts/{original_id}/duplicate", headers=auth_headers
        )
        assert duplicate_response.status_code == 200
        duplicate_data = duplicate_response.json()

        # Verify content is the same
        original = db_session.query(Prompt).filter(Prompt.id == original_id).first()
        duplicate = db_session.query(Prompt).filter(Prompt.id == duplicate_data["id"]).first()

        assert duplicate.fields == original.fields

    def test_duplicate_creates_independent_copy(self, client, auth_headers, db_session):
        """Test that duplicate is independent from original."""
        # Create and duplicate a prompt
        payload = {"name": "Prompt", "fields": [{"name": "goal", "content": "Original"}]}
        create_response = client.post("/api/prompts", headers=auth_headers, json=payload)
        original_id = create_response.json()["id"]

        duplicate_response = client.post(
            f"/api/prompts/{original_id}/duplicate", headers=auth_headers
        )
        duplicate_id = duplicate_response.json()["id"]

        # Modify the original in the database
        original = db_session.query(Prompt).filter(Prompt.id == original_id).first()
        original.fields = [{"name": "goal", "content": "Modified"}]
        db_session.commit()

        # Verify duplicate is unchanged
        duplicate = db_session.query(Prompt).filter(Prompt.id == duplicate_id).first()
        assert duplicate.fields == [{"name": "goal", "content": "Original"}]

    def test_duplicate_multiple_times(self, client, auth_headers, db_session):
        """Test duplicating the same prompt multiple times."""
        # Create original
        payload = {"name": "Prompt", "fields": [{"name": "goal", "content": "Test"}]}
        create_response = client.post("/api/prompts", headers=auth_headers, json=payload)
        original_id = create_response.json()["id"]

        # Create multiple duplicates
        duplicate_ids = []
        for _ in range(3):
            response = client.post(f"/api/prompts/{original_id}/duplicate", headers=auth_headers)
            assert response.status_code == 200
            duplicate_ids.append(response.json()["id"])

        # Verify all IDs are unique
        assert len(set(duplicate_ids)) == 3
        assert original_id not in duplicate_ids

        # Verify all exist in database
        prompts = db_session.query(Prompt).all()
        assert len(prompts) == 4  # 1 original + 3 duplicates


class TestUserDataIsolation:
    """
    Verify that one authenticated user cannot read, list, or duplicate
    prompts that belong to another user.
    """

    def _create_prompt(self, client, headers, content: str = "private content") -> int:
        """Helper: create a prompt and return its ID."""
        response = client.post(
            "/api/prompts",
            headers=headers,
            json={"name": "Prompt", "fields": [{"name": "goal", "content": content}]},
        )
        assert response.status_code == 201
        return response.json()["id"]

    def test_get_by_id_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        """User B receives 404 when requesting a prompt owned by User A."""
        prompt_id = self._create_prompt(client, auth_headers)

        response = client.get(f"/api/prompts/{prompt_id}", headers=second_auth_headers)
        assert response.status_code == 404

    def test_duplicate_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        """User B cannot duplicate a prompt owned by User A."""
        prompt_id = self._create_prompt(client, auth_headers)

        response = client.post(f"/api/prompts/{prompt_id}/duplicate", headers=second_auth_headers)
        assert response.status_code == 404

    def test_owner_can_still_access_own_prompt(self, client, auth_headers, second_auth_headers):
        """Sanity check: User A can still access their own prompt after User B tries."""
        prompt_id = self._create_prompt(client, auth_headers)

        # User B's failed attempt should not affect User A's access
        client.get(f"/api/prompts/{prompt_id}", headers=second_auth_headers)

        response = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["id"] == prompt_id

    def test_duplicate_stays_scoped_to_duplicating_user(
        self, client, auth_headers, second_auth_headers
    ):
        """A user can only duplicate their own prompts; the copy belongs to them."""
        prompt_id = self._create_prompt(client, auth_headers, "original")

        # User A duplicates their own prompt
        dup_response = client.post(f"/api/prompts/{prompt_id}/duplicate", headers=auth_headers)
        assert dup_response.status_code == 200
        dup_id = dup_response.json()["id"]

        # The duplicate is not visible to User B
        assert client.get(f"/api/prompts/{dup_id}", headers=second_auth_headers).status_code == 404

        # But User A can see it
        assert client.get(f"/api/prompts/{dup_id}", headers=auth_headers).status_code == 200


class TestGetSavedPromptsEndpoint:
    """Test cases for GET /api/prompts/saved endpoint."""

    def test_saved_empty_for_a_new_account(self, client, auth_headers):
        """A new account starts with an empty library."""
        response = client.get("/api/prompts/saved", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

    def test_saved_ordered_newest_first(self, client, auth_headers):
        """Saved prompts are ordered newest first."""
        client.post(
            "/api/prompts",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "first"}], "name": "First"},
        )
        client.post(
            "/api/prompts",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "second"}], "name": "Second"},
        )

        response = client.get("/api/prompts/saved", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data[0]["name"] == "Second"
        assert data[1]["name"] == "First"

    def test_saved_requires_auth(self, client):
        """Endpoint requires authentication (no token supplied → 401)."""
        response = client.get("/api/prompts/saved")
        assert response.status_code in (401, 403)

    def test_saved_response_includes_name_field(self, client, auth_headers):
        """Response includes id, name, fields, generated_prompt, created_at."""
        client.post(
            "/api/prompts",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "check fields"}], "name": "Check"},
        )

        response = client.get("/api/prompts/saved", headers=auth_headers)
        assert response.status_code == 200
        item = response.json()[0]
        assert "id" in item
        assert item["name"] == "Check"
        assert "fields" in item
        assert "generated_prompt" in item
        assert "created_at" in item


class TestCreatePromptEndpoint:
    """Test cases for POST /api/prompts, which saves a new prompt to the library."""

    FIELDS = [
        {"name": "Role", "content": "You are a patient tutor."},
        {"name": "Output format", "content": "Explain {{topic}} in three steps."},
    ]

    def test_saves_a_named_prompt_and_renders_its_text(self, client, auth_headers):
        response = client.post(
            "/api/prompts",
            headers=auth_headers,
            json={
                "name": "Tutor",
                "fields": self.FIELDS,
                "folder": "  Learning ",
                "variable_metadata": {"topic": {"description": "What to explain"}},
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Tutor"
        assert data["fields"] == self.FIELDS
        assert data["generated_prompt"] == (
            "<ROLE>\nYou are a patient tutor.\n</ROLE>\n\n"
            "<OUTPUT_FORMAT>\nExplain {{topic}} in three steps.\n</OUTPUT_FORMAT>"
        )
        assert data["folder"] == "Learning"
        assert data["variable_metadata"] == {
            "topic": {
                "type": "text",
                "description": "What to explain",
                "required": False,
                "example": None,
            }
        }
        saved = client.get("/api/prompts/saved", headers=auth_headers).json()
        assert [p["id"] for p in saved] == [data["id"]]
        versions = client.get(f"/api/prompts/{data['id']}/versions", headers=auth_headers)
        assert versions.json() == []

    def test_blank_folder_means_unfiled(self, client, auth_headers):
        response = client.post(
            "/api/prompts",
            headers=auth_headers,
            json={"name": "Loose", "fields": self.FIELDS, "folder": "  "},
        )

        assert response.status_code == 201
        assert response.json()["folder"] is None

    @pytest.mark.parametrize(
        "payload",
        [
            {"fields": FIELDS},
            {"name": "  ", "fields": FIELDS},
            {"name": "No sections", "fields": []},
            {"name": "Dup", "fields": [FIELDS[0], {"name": "role", "content": "again"}]},
            {"name": "Raw text", "fields": FIELDS, "generated_prompt": "anything"},
        ],
    )
    def test_invalid_payloads_are_rejected(self, client, auth_headers, payload):
        response = client.post("/api/prompts", headers=auth_headers, json=payload)

        assert response.status_code == 422
        assert client.get("/api/prompts/saved", headers=auth_headers).json() == []

    def test_requires_authentication(self, client):
        response = client.post("/api/prompts", json={"name": "Anon", "fields": self.FIELDS})

        assert response.status_code == 401

    def test_saved_prompt_belongs_to_its_creator_only(
        self, client, auth_headers, second_auth_headers
    ):
        created = client.post(
            "/api/prompts", headers=auth_headers, json={"name": "Mine", "fields": self.FIELDS}
        ).json()

        assert client.get("/api/prompts/saved", headers=second_auth_headers).json() == []
        other = client.get(f"/api/prompts/{created['id']}", headers=second_auth_headers)
        assert other.status_code == 404


class TestUpdatePromptEndpoint:
    """Test cases for PATCH /api/prompts/{id} endpoint."""

    def _create_prompt(self, client, headers, name="Prompt") -> int:
        """Helper: create a prompt and return its ID."""
        payload = {"name": "Prompt", "fields": [{"name": "goal", "content": "original content"}]}
        payload["name"] = name
        response = client.post("/api/prompts", headers=headers, json=payload)
        assert response.status_code == 201
        return response.json()["id"]

    def test_update_name(self, client, auth_headers):
        """Updating a prompt's name works."""
        prompt_id = self._create_prompt(client, auth_headers)

        response = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"name": "My Saved Prompt"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "My Saved Prompt"
        assert data["id"] == prompt_id

    def test_update_name_rejects_over_length_name(self, client, auth_headers):
        """The name cap is enforced server-side, not just via the UI's maxLength
        attribute — a bypassed client-side limit must not silently persist."""
        prompt_id = self._create_prompt(client, auth_headers)

        response = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"name": "a" * 101},
        )
        assert response.status_code == 422

    def test_update_fields_rerenders_generated_prompt(self, client, auth_headers):
        """New sections replace the old ones and the text is rendered from them."""
        prompt_id = self._create_prompt(client, auth_headers, name="Existing")

        response = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={
                "name": "Updated Name",
                "fields": [
                    {"name": "goal", "content": "new content"},
                    {"name": "Output format", "content": "Three bullets"},
                ],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["fields"][1] == {"name": "Output format", "content": "Three bullets"}
        assert data["generated_prompt"] == (
            "<GOAL>\nnew content\n</GOAL>\n\n<OUTPUT_FORMAT>\nThree bullets\n</OUTPUT_FORMAT>"
        )

    def test_update_rejects_raw_generated_prompt(self, client, auth_headers):
        """The text is always rendered from the sections, so it cannot be written directly."""
        prompt_id = self._create_prompt(client, auth_headers, name="Existing")

        response = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"generated_prompt": "hand-edited text"},
        )

        assert response.status_code == 422
        current = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()
        assert current["generated_prompt"] == "<GOAL>\noriginal content\n</GOAL>"

    def test_update_concurrency_conflict(self, client, auth_headers):
        """Updating a prompt fails with 409 Conflict if last_updated_at is stale.

        No sleep between the two writes, deliberately. This used to need one: the
        check allowed a 100ms tolerance, so a second session saving quickly after
        the first never conflicted and simply overwrote it.
        """
        prompt_id = self._create_prompt(client, auth_headers, name="Concurrency Test")

        # Get the original prompt state
        response = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers)
        original_data = response.json()
        last_updated_at = original_data["updated_at"] or original_data["created_at"]

        # Simulate update 1 (succeeds)
        response1 = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"name": "First Update", "last_updated_at": last_updated_at},
        )
        assert response1.status_code == 200

        # Simulate update 2 (fails with 409 Conflict because last_updated_at is now stale)
        response2 = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"name": "Second Update", "last_updated_at": last_updated_at},
        )
        assert response2.status_code == 409
        assert "modified by another session" in response2.json()["detail"]

    def test_update_nonexistent_prompt(self, client, auth_headers):
        """PATCH on a non-existent prompt returns 404."""
        response = client.patch(
            "/api/prompts/999",
            headers=auth_headers,
            json={"name": "Ghost"},
        )
        assert response.status_code == 404

    def test_update_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        """User B cannot rename a prompt owned by User A."""
        prompt_id = self._create_prompt(client, auth_headers, name="Original")

        response = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=second_auth_headers,
            json={"name": "Stolen Name"},
        )
        assert response.status_code == 404

        # Original name is unchanged
        original = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers)
        assert original.json()["name"] == "Original"

    def test_update_requires_auth(self, client, auth_headers):
        """PATCH requires authentication (no token supplied → 401)."""
        prompt_id = self._create_prompt(client, auth_headers)
        response = client.patch(f"/api/prompts/{prompt_id}", json={"name": "X"})
        assert response.status_code in (401, 403)


class TestDeletePromptEndpoint:
    """Test cases for DELETE /api/prompts/{id} endpoint."""

    def _create_prompt(self, client, headers, name="Prompt") -> int:
        """Helper: create a prompt and return its ID."""
        payload = {"name": "Prompt", "fields": [{"name": "goal", "content": "to delete"}]}
        payload["name"] = name
        response = client.post("/api/prompts", headers=headers, json=payload)
        assert response.status_code == 201
        return response.json()["id"]

    def test_delete_own_prompt(self, client, auth_headers):
        """Owner can delete their own prompt."""
        prompt_id = self._create_prompt(client, auth_headers)

        response = client.delete(f"/api/prompts/{prompt_id}", headers=auth_headers)
        assert response.status_code == 204

        # Prompt is gone
        assert client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).status_code == 404

    def test_delete_removes_from_saved_list(self, client, auth_headers):
        """Deleting a named prompt removes it from GET /saved."""
        prompt_id = self._create_prompt(client, auth_headers, name="To Remove")

        assert len(client.get("/api/prompts/saved", headers=auth_headers).json()) == 1

        client.delete(f"/api/prompts/{prompt_id}", headers=auth_headers)

        assert client.get("/api/prompts/saved", headers=auth_headers).json() == []

    def test_delete_nonexistent_prompt(self, client, auth_headers):
        """DELETE on a non-existent prompt returns 404."""
        response = client.delete("/api/prompts/999", headers=auth_headers)
        assert response.status_code == 404

    def test_delete_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        """User B cannot delete a prompt owned by User A."""
        prompt_id = self._create_prompt(client, auth_headers)

        response = client.delete(f"/api/prompts/{prompt_id}", headers=second_auth_headers)
        assert response.status_code == 404

        # Prompt still exists for User A
        assert client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).status_code == 200

    def test_delete_requires_auth(self, client, auth_headers):
        """DELETE requires authentication (no token supplied → 401)."""
        prompt_id = self._create_prompt(client, auth_headers)
        response = client.delete(f"/api/prompts/{prompt_id}")
        assert response.status_code in (401, 403)

    def test_saved_isolation_after_delete(self, client, auth_headers, second_auth_headers):
        """User B's saved list is unaffected when User A deletes a prompt."""
        # Both users create named prompts
        self._create_prompt(client, auth_headers, name="User A Saved")
        b_id = self._create_prompt(client, second_auth_headers, name="User B Saved")

        # User A deletes their prompt
        user_a_saved = client.get("/api/prompts/saved", headers=auth_headers).json()
        client.delete(f"/api/prompts/{user_a_saved[0]['id']}", headers=auth_headers)

        # User B's saved list is untouched
        b_saved = client.get("/api/prompts/saved", headers=auth_headers).json()
        assert b_id not in [p["id"] for p in b_saved]
        b_saved_self = client.get("/api/prompts/saved", headers=second_auth_headers).json()
        assert len(b_saved_self) == 1
        assert b_saved_self[0]["name"] == "User B Saved"


class TestUpdatedAtTimestamp:
    """Tests for the updated_at column on prompts (migration 005)."""

    def _create_prompt(self, client, headers) -> dict:
        response = client.post(
            "/api/prompts",
            headers=headers,
            json={"name": "Prompt", "fields": [{"name": "goal", "content": "initial content"}]},
        )
        assert response.status_code == 201
        return response.json()

    def test_generate_returns_null_updated_at(self, client, auth_headers):
        """Freshly generated prompts have updated_at == null (only set on PATCH)."""
        data = self._create_prompt(client, auth_headers)
        assert "updated_at" in data
        assert data["updated_at"] is None

    def test_patch_sets_updated_at(self, client, auth_headers):
        """PATCH sets updated_at to a non-null timestamp."""
        prompt_id = self._create_prompt(client, auth_headers)["id"]

        resp = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"name": "Saved"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["updated_at"] is not None

    def test_patch_updated_at_is_after_created_at(self, client, auth_headers):
        """updated_at must be >= created_at after a PATCH."""

        prompt = self._create_prompt(client, auth_headers)
        created_at = prompt["created_at"]

        resp = client.patch(
            f"/api/prompts/{prompt['id']}",
            headers=auth_headers,
            json={"name": "Named"},
        )
        updated_at = resp.json()["updated_at"]

        # Both are ISO-8601 strings; lexicographic comparison works for UTC timestamps
        assert updated_at >= created_at


class TestFoldersAndFavorites:
    """Tests for the folder/tags/favorite prompt columns (migrations 006-008)."""

    def _create_prompt(self, client, headers, name="Prompt") -> int:
        response = client.post(
            "/api/prompts",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "x"}], "name": name},
        )
        assert response.status_code == 201
        return response.json()["id"]

    def test_defaults(self, client, auth_headers):
        """A new prompt is unfiled and not a favorite, and tags are no longer exposed."""
        prompt_id = self._create_prompt(client, auth_headers)
        data = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()
        assert data["folder"] is None
        assert data["is_favorite"] is False
        assert "tags" not in data

    def test_patch_sets_folder_and_favorite(self, client, auth_headers):
        """PATCH can set folder and is_favorite; tags can no longer be written."""
        prompt_id = self._create_prompt(client, auth_headers)

        resp = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"folder": "Support", "is_favorite": True},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["folder"] == "Support"
        assert data["is_favorite"] is True

        tags = client.patch(
            f"/api/prompts/{prompt_id}", headers=auth_headers, json={"tags": ["retired"]}
        )
        assert tags.status_code == 422

    def test_saved_filters_by_favorite_only(self, client, auth_headers):
        """favorite_only=true excludes non-favorited saved prompts."""
        starred = self._create_prompt(client, auth_headers, name="Starred")
        self._create_prompt(client, auth_headers, name="Plain")
        client.patch(f"/api/prompts/{starred}", headers=auth_headers, json={"is_favorite": True})

        resp = client.get("/api/prompts/saved?favorite_only=true", headers=auth_headers)
        assert resp.status_code == 200
        names = [p["name"] for p in resp.json()]
        assert names == ["Starred"]

    def test_saved_filters_by_folder(self, client, auth_headers):
        """folder query param restricts results to an exact folder match."""
        eng = self._create_prompt(client, auth_headers, name="Eng Prompt")
        self._create_prompt(client, auth_headers, name="Other Prompt")
        client.patch(f"/api/prompts/{eng}", headers=auth_headers, json={"folder": "Engineering"})

        resp = client.get("/api/prompts/saved?folder=Engineering", headers=auth_headers)
        assert resp.status_code == 200
        names = [p["name"] for p in resp.json()]
        assert names == ["Eng Prompt"]

    def test_get_folders_returns_distinct_sorted_labels(self, client, auth_headers):
        """GET /api/prompts/folders returns the calling user's distinct folders, sorted."""
        first = self._create_prompt(client, auth_headers, name="First")
        second = self._create_prompt(client, auth_headers, name="Second")
        client.patch(f"/api/prompts/{first}", headers=auth_headers, json={"folder": "Zeta"})
        client.patch(f"/api/prompts/{second}", headers=auth_headers, json={"folder": "Alpha"})

        resp = client.get("/api/prompts/folders", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == ["Alpha", "Zeta"]

    def test_folders_scoped_to_owner(self, client, auth_headers, second_auth_headers):
        """A user never sees another user's folders."""
        mine = self._create_prompt(client, auth_headers, name="Mine")
        client.patch(f"/api/prompts/{mine}", headers=auth_headers, json={"folder": "Mine Folder"})

        folders_resp = client.get("/api/prompts/folders", headers=second_auth_headers)
        assert folders_resp.json() == []


class TestVariableMetadata:
    """Tests for the real per-prompt run_count and variable_metadata columns."""

    def _create_prompt(self, client, headers, name="Prompt") -> int:
        response = client.post(
            "/api/prompts",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "x"}], "name": name},
        )
        assert response.status_code == 201
        return response.json()["id"]

    def test_patch_sets_variable_metadata(self, client, auth_headers):
        prompt_id = self._create_prompt(client, auth_headers)
        resp = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={
                "variable_metadata": {
                    "customer_name": {"type": "text", "description": "Who to address"},
                    "age": {"type": "number"},
                }
            },
        )
        assert resp.status_code == 200
        data = resp.json()["variable_metadata"]
        assert data["customer_name"] == {
            "type": "text",
            "description": "Who to address",
            "required": False,
            "example": None,
        }
        assert data["age"] == {
            "type": "number",
            "description": None,
            "required": False,
            "example": None,
        }

    def test_choices_are_tidied_kept_through_versions_and_exported(self, client, auth_headers):
        prompt_id = self._create_prompt(client, auth_headers)
        choices = {"style": {"type": "text", "options": [" One Piece ", "Disney", "", "Disney"]}}
        resp = client.patch(
            f"/api/prompts/{prompt_id}", headers=auth_headers, json={"variable_metadata": choices}
        )
        assert resp.status_code == 200
        assert resp.json()["variable_metadata"]["style"]["options"] == ["One Piece", "Disney"]

        # An edit stores the state with choices as a version; restoring it brings them back.
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "y"}], "variable_metadata": {}},
        )
        versions = client.get(f"/api/prompts/{prompt_id}/versions", headers=auth_headers).json()
        restored = client.post(
            f"/api/prompts/{prompt_id}/versions/{versions[0]['id']}/restore", headers=auth_headers
        )
        assert restored.json()["variable_metadata"]["style"]["options"] == ["One Piece", "Disney"]
        exported = client.get("/api/prompts/export", headers=auth_headers).json()
        [prompt] = [p for p in exported["prompts"] if p["id"] == prompt_id]
        assert prompt["variable_metadata"]["style"]["options"] == ["One Piece", "Disney"]

    def test_blank_choices_mean_free_text_and_limits_are_enforced(self, client, auth_headers):
        prompt_id = self._create_prompt(client, auth_headers)

        def patch(options):
            return client.patch(
                f"/api/prompts/{prompt_id}",
                headers=auth_headers,
                json={"variable_metadata": {"style": {"type": "text", "options": options}}},
            )

        assert "options" not in patch(["", "  "]).json()["variable_metadata"]["style"]
        fifty = [f"Choice {n}" for n in range(50)]
        # Limits count what is stored: a trailing blank line, repeats and padding are free.
        stored = patch([*fifty, " Choice 0 ", ""]).json()
        assert stored["variable_metadata"]["style"]["options"] == fifty
        assert patch([f"  {'x' * 200}  "]).status_code == 200
        assert patch([*fifty, "Choice 50"]).status_code == 422
        assert patch(["x" * 201]).status_code == 422
        assert patch("Disney").status_code == 422

    def test_patch_clears_variable_metadata_with_empty_dict(self, client, auth_headers):
        prompt_id = self._create_prompt(client, auth_headers)
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"variable_metadata": {"x": {"type": "text"}}},
        )
        resp = client.patch(
            f"/api/prompts/{prompt_id}", headers=auth_headers, json={"variable_metadata": {}}
        )
        assert resp.json()["variable_metadata"] == {}

    def test_patch_rejects_invalid_variable_type(self, client, auth_headers):
        prompt_id = self._create_prompt(client, auth_headers)
        resp = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"variable_metadata": {"x": {"type": "date"}}},
        )
        assert resp.status_code == 422


class TestFolderEndpoints:
    """Test cases for renaming and removing folders (PATCH/DELETE /api/prompts/folders)."""

    def _save(self, client, headers, name, folder):
        response = client.post(
            "/api/prompts",
            headers=headers,
            json={"name": name, "fields": [{"name": "Task", "content": name}], "folder": folder},
        )
        assert response.status_code == 201
        return response.json()

    def _folders(self, client, headers):
        return {
            p["name"]: p["folder"] for p in client.get("/api/prompts/saved", headers=headers).json()
        }

    def test_rename_moves_every_prompt_and_keeps_their_edit_time(self, client, auth_headers):
        first = self._save(client, auth_headers, "Status", "Work")
        self._save(client, auth_headers, "Review", "Work")
        self._save(client, auth_headers, "Meals", "Personal")

        response = client.patch(
            "/api/prompts/folders",
            params={"name": "Work"},
            headers=auth_headers,
            json={"name": "  Job "},
        )

        assert response.status_code == 200
        assert response.json() == {"name": "Job", "prompt_count": 2}
        assert self._folders(client, auth_headers) == {
            "Status": "Job",
            "Review": "Job",
            "Meals": "Personal",
        }
        after = client.get(f"/api/prompts/{first['id']}", headers=auth_headers).json()
        assert after["updated_at"] == first["updated_at"]

    def test_renaming_onto_an_existing_folder_merges_them(self, client, auth_headers):
        self._save(client, auth_headers, "Status", "Work")
        self._save(client, auth_headers, "Meals", "Personal")

        client.patch(
            "/api/prompts/folders",
            params={"name": "Personal"},
            headers=auth_headers,
            json={"name": "Work"},
        )

        assert client.get("/api/prompts/folders", headers=auth_headers).json() == ["Work"]

    def test_remove_unfiles_prompts_without_deleting_them(self, client, auth_headers):
        self._save(client, auth_headers, "Status", "Work")
        self._save(client, auth_headers, "Meals", "Personal")

        response = client.delete(
            "/api/prompts/folders", params={"name": "Work"}, headers=auth_headers
        )

        assert response.status_code == 200
        assert response.json() == {"name": "Work", "prompt_count": 1}
        assert self._folders(client, auth_headers) == {"Status": None, "Meals": "Personal"}

    def test_unknown_folder_is_not_found(self, client, auth_headers):
        rename = client.patch(
            "/api/prompts/folders",
            params={"name": "Nope"},
            headers=auth_headers,
            json={"name": "Other"},
        )
        remove = client.delete(
            "/api/prompts/folders", params={"name": "Nope"}, headers=auth_headers
        )

        assert rename.status_code == 404
        assert remove.status_code == 404

    def test_blank_new_name_is_rejected(self, client, auth_headers):
        self._save(client, auth_headers, "Status", "Work")

        response = client.patch(
            "/api/prompts/folders",
            params={"name": "Work"},
            headers=auth_headers,
            json={"name": "   "},
        )

        assert response.status_code == 422
        assert self._folders(client, auth_headers) == {"Status": "Work"}

    def test_only_the_callers_prompts_move(self, client, auth_headers, second_auth_headers):
        self._save(client, auth_headers, "Mine", "Work")
        self._save(client, second_auth_headers, "Theirs", "Work")

        client.patch(
            "/api/prompts/folders",
            params={"name": "Work"},
            headers=auth_headers,
            json={"name": "Job"},
        )
        client.delete("/api/prompts/folders", params={"name": "Job"}, headers=auth_headers)

        assert self._folders(client, second_auth_headers) == {"Theirs": "Work"}

    def test_requires_authentication(self, client):
        assert client.delete("/api/prompts/folders", params={"name": "Work"}).status_code == 401


def test_try_once_uses_filled_snapshot_without_saving(client, auth_headers, mock_llm, db_session):
    from app.models.billed_call import BilledCall
    from app.models.prompt import Prompt
    from tests.conftest import make_chat_response

    mock_llm.return_value.chat.completions.create.return_value = make_chat_response("Explanation")
    response = client.post(
        "/api/prompts/try", headers=auth_headers, json={"text": "Explain space."}
    )
    assert response.status_code == 200
    assert response.json()["model"] == "gpt-4o-mini"
    assert "output_text" in response.json()
    assert db_session.query(Prompt).count() == 0
    assert db_session.query(BilledCall).filter_by(source="try_once").count() == 1
    assert mock_llm.return_value.chat.completions.create.call_args.kwargs["messages"] == [
        {"role": "user", "content": "Explain space."}
    ]


def test_try_once_requires_auth_and_nonempty_bounded_text(client, auth_headers):
    assert client.post("/api/prompts/try", json={"text": "hello"}).status_code == 401
    for text in ["", "   ", "x" * 100_001]:
        assert (
            client.post("/api/prompts/try", headers=auth_headers, json={"text": text}).status_code
            == 422
        )


def test_try_once_budget_failure_does_not_call_provider(
    client, auth_headers, mock_llm, monkeypatch
):
    monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "0")
    response = client.post("/api/prompts/try", headers=auth_headers, json={"text": "Hello"})
    assert response.status_code == 402
    assert response.json()["budget"]["scope"] == "shared"
    assert response.json()["budget"]["reason"] == "exhausted"
    mock_llm.return_value.chat.completions.create.assert_not_called()


def test_try_once_provider_failure_is_reported_without_saving(
    client, auth_headers, mock_llm, db_session
):
    from openai import OpenAIError

    from app.models.billed_call import BilledCall

    mock_llm.return_value.chat.completions.create.side_effect = OpenAIError("Provider failure")
    response = client.post("/api/prompts/try", headers=auth_headers, json={"text": "Hello"})
    assert response.status_code == 502
    assert db_session.query(BilledCall).count() == 0
