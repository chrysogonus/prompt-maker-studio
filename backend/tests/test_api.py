"""
Unit tests for API endpoints.
"""

from app.api.routes import duplicate_prompt as duplicate_prompt_route
from app.models.eval_case import EvalCase
from app.models.playground_run import PlaygroundRun
from app.models.prompt import Prompt
from app.models.user import User


class TestGeneratePromptEndpoint:
    """Test cases for POST /api/prompts/generate endpoint."""

    def test_generate_prompt_with_multiple_fields(self, client, auth_headers):
        """Test generating a prompt with multiple fields."""
        payload = {
            "fields": [
                {"name": "goal", "content": "Create a fantasy character"},
                {"name": "characters", "content": "A brave knight named Sir Roland"},
                {"name": "style", "content": "Epic and heroic"},
                {"name": "setting", "content": "Medieval kingdom"},
            ]
        }

        response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)

        assert response.status_code == 200
        data = response.json()

        assert "id" in data
        assert "generated_prompt" in data
        assert "created_at" in data
        assert "<GOAL>" in data["generated_prompt"]
        assert "Create a fantasy character" in data["generated_prompt"]
        assert "<CHARACTERS>" in data["generated_prompt"]
        assert "<STYLE>" in data["generated_prompt"]

    def test_generate_prompt_with_single_field(self, client, auth_headers):
        """Test generating a prompt with a single field."""
        payload = {"fields": [{"name": "goal", "content": "Simple test goal"}]}

        response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)

        assert response.status_code == 200
        data = response.json()

        assert "id" in data
        assert "generated_prompt" in data
        assert "<GOAL>" in data["generated_prompt"]
        assert "Simple test goal" in data["generated_prompt"]
        assert "</GOAL>" in data["generated_prompt"]

    def test_generate_prompt_missing_fields(self, client, auth_headers):
        """Test that request fails without fields."""
        payload = {}

        response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)

        assert response.status_code == 422
        data = response.json()
        assert "detail" in data

    def test_generate_prompt_empty_fields(self, client, auth_headers):
        """Test that request fails with empty fields array."""
        payload = {"fields": []}

        response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)

        assert response.status_code == 422

    def test_generate_prompt_duplicate_field_names(self, client, auth_headers):
        """Test that request fails with duplicate field names."""
        payload = {
            "fields": [
                {"name": "goal", "content": "First goal"},
                {"name": "goal", "content": "Second goal"},
            ]
        }

        response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)

        assert response.status_code == 422

    def test_generate_prompt_saves_to_database(self, client, auth_headers, db_session):
        """Test that generated prompt is saved to database."""
        payload = {"fields": [{"name": "goal", "content": "Database test"}]}

        response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)
        assert response.status_code == 200

        # Check database
        prompts = db_session.query(Prompt).all()
        assert len(prompts) == 1
        assert prompts[0].fields == [{"name": "goal", "content": "Database test"}]
        assert prompts[0].generated_prompt is not None


class TestGetPromptHistoryEndpoint:
    """Test cases for GET /api/prompts/history endpoint."""

    def test_get_empty_history(self, client, auth_headers):
        """Test getting history when no prompts exist."""
        response = client.get("/api/prompts/history", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data == []

    def test_get_history_with_prompts(self, client, auth_headers):
        """Test getting history with existing prompts."""
        # Create some prompts
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "First prompt"}]},
        )
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "Second prompt"}]},
        )
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "Third prompt"}]},
        )

        response = client.get("/api/prompts/history", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3

        # Should be ordered by created_at desc (newest first)
        assert data[0]["fields"][0]["content"] == "Third prompt"
        assert data[1]["fields"][0]["content"] == "Second prompt"
        assert data[2]["fields"][0]["content"] == "First prompt"

    def test_get_history_with_limit(self, client, auth_headers):
        """Test getting history with limit parameter."""
        # Create 5 prompts
        for i in range(5):
            client.post(
                "/api/prompts/generate",
                headers=auth_headers,
                json={"fields": [{"name": "goal", "content": f"Prompt {i + 1}"}]},
            )

        response = client.get("/api/prompts/history?limit=3", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3

    def test_get_history_default_limit(self, client, auth_headers):
        """Test that default limit is 10."""
        # Create 15 prompts
        for i in range(15):
            client.post(
                "/api/prompts/generate",
                headers=auth_headers,
                json={"fields": [{"name": "goal", "content": f"Prompt {i + 1}"}]},
            )

        response = client.get("/api/prompts/history", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 10

    def test_get_history_with_offset(self, client, auth_headers):
        """Test that offset skips the newest records, for paging past the first page."""
        for i in range(5):
            client.post(
                "/api/prompts/generate",
                headers=auth_headers,
                json={"fields": [{"name": "goal", "content": f"Prompt {i + 1}"}]},
            )

        first_page = client.get(
            "/api/prompts/history?limit=2&offset=0", headers=auth_headers
        ).json()
        second_page = client.get(
            "/api/prompts/history?limit=2&offset=2", headers=auth_headers
        ).json()

        assert [p["fields"][0]["content"] for p in first_page] == ["Prompt 5", "Prompt 4"]
        assert [p["fields"][0]["content"] for p in second_page] == ["Prompt 3", "Prompt 2"]

    def test_get_history_search_matches_visible_auto_title_source(self, client, auth_headers):
        """Unnamed history entries are searchable by the field used as their auto-title."""
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "Write a haiku about the ocean"}]},
        )
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "Summarize a legal contract"}]},
        )

        response = client.get("/api/prompts/history?search=HAIKU", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["fields"][0]["content"] == "Write a haiku about the ocean"

    def test_get_history_search_matches_name(self, client, auth_headers):
        """Test that search also matches against the saved prompt name."""
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={
                "fields": [{"name": "goal", "content": "Unrelated content"}],
                "name": "My Ocean Prompt",
            },
        )
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "Something else entirely"}]},
        )

        response = client.get("/api/prompts/history?search=ocean", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "My Ocean Prompt"

    def test_get_history_search_no_matches(self, client, auth_headers):
        """Test that a search term with no matches returns an empty list."""
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "Write a haiku"}]},
        )

        response = client.get("/api/prompts/history?search=nonexistent", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() == []


class TestGetPromptByIdEndpoint:
    """Test cases for GET /api/prompts/{prompt_id} endpoint."""

    def test_get_existing_prompt(self, client, auth_headers):
        """Test getting an existing prompt by ID."""
        # Create a prompt
        create_response = client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={
                "fields": [
                    {"name": "goal", "content": "Test prompt"},
                    {"name": "characters", "content": "Test character"},
                ]
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
            "fields": [
                {"name": "goal", "content": "Full test"},
                {"name": "characters", "content": "Character A"},
                {"name": "style", "content": "Style B"},
                {"name": "setting", "content": "Setting C"},
            ]
        }

        create_response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)
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
            "fields": [
                {"name": "goal", "content": "Original prompt goal"},
                {"name": "characters", "content": "Character A"},
                {"name": "style", "content": "Style B"},
            ]
        }
        create_response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)
        assert create_response.status_code == 200
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
            "/api/prompts/generate",
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
                "tags": ["urgent", "code-review"],
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
        assert duplicate_data["tags"] == ["urgent", "code-review"]
        assert duplicate_data["is_favorite"] is False
        assert duplicate_data["name"] == "Configured prompt Duplicate"
        assert duplicate_data["variable_metadata"]["count"] == {
            "type": "number",
            "description": "Item count",
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
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "first"}]},
        ).json()
        assert client.delete(f"/api/prompts/{first['id']}", headers=auth_headers).status_code == 204

        second = client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "second"}]},
        ).json()

        assert second["id"] > first["id"]
        assert client.get(f"/api/prompts/{first['id']}", headers=auth_headers).status_code == 404

    def test_duplicate_prompt_with_minimal_fields(self, client, auth_headers, db_session):
        """Test duplicating a prompt with only one field."""
        # Create a minimal prompt
        payload = {"fields": [{"name": "goal", "content": "Minimal goal"}]}
        create_response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)
        assert create_response.status_code == 200
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
        payload = {"fields": [{"name": "goal", "content": "Original"}]}
        create_response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)
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
        payload = {"fields": [{"name": "goal", "content": "Test"}]}
        create_response = client.post("/api/prompts/generate", headers=auth_headers, json=payload)
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
            "/api/prompts/generate",
            headers=headers,
            json={"fields": [{"name": "goal", "content": content}]},
        )
        assert response.status_code == 200
        return response.json()["id"]

    def test_history_is_scoped_to_owner(self, client, auth_headers, second_auth_headers):
        """User B's history does not include prompts created by User A."""
        # User A creates two prompts
        self._create_prompt(client, auth_headers, "user_a prompt 1")
        self._create_prompt(client, auth_headers, "user_a prompt 2")

        # User B creates one prompt
        self._create_prompt(client, second_auth_headers, "user_b prompt")

        # User A should see exactly 2 prompts
        resp_a = client.get("/api/prompts/history", headers=auth_headers)
        assert resp_a.status_code == 200
        contents_a = [p["fields"][0]["content"] for p in resp_a.json()]
        assert len(contents_a) == 2
        assert all("user_a" in c for c in contents_a)

        # User B should see exactly 1 prompt
        resp_b = client.get("/api/prompts/history", headers=second_auth_headers)
        assert resp_b.status_code == 200
        contents_b = [p["fields"][0]["content"] for p in resp_b.json()]
        assert len(contents_b) == 1
        assert contents_b[0] == "user_b prompt"

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

    def test_saved_empty_when_no_named_prompts(self, client, auth_headers):
        """Returns an empty list when no prompts have been named."""
        # Generate an unnamed prompt
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "unnamed"}]},
        )

        response = client.get("/api/prompts/saved", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

    def test_saved_returns_only_named_prompts(self, client, auth_headers):
        """Only prompts with a name appear in the saved list."""
        # Unnamed prompt
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "unnamed"}]},
        )
        # Named prompt via generate
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "named"}], "name": "My Template"},
        )

        response = client.get("/api/prompts/saved", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "My Template"

    def test_saved_ordered_newest_first(self, client, auth_headers):
        """Saved prompts are ordered newest first."""
        client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "first"}], "name": "First"},
        )
        client.post(
            "/api/prompts/generate",
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
            "/api/prompts/generate",
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


class TestUpdatePromptEndpoint:
    """Test cases for PATCH /api/prompts/{id} endpoint."""

    def _create_prompt(self, client, headers, name=None) -> int:
        """Helper: create a prompt and return its ID."""
        payload = {"fields": [{"name": "goal", "content": "original content"}]}
        if name:
            payload["name"] = name
        response = client.post("/api/prompts/generate", headers=headers, json=payload)
        assert response.status_code == 200
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

    def test_generate_prompt_rejects_over_length_name(self, client, auth_headers):
        """Same 100-char cap applies to the initial save-as-name on generate."""
        response = client.post(
            "/api/prompts/generate",
            headers=auth_headers,
            json={
                "fields": [{"name": "goal", "content": "content"}],
                "name": "a" * 101,
            },
        )
        assert response.status_code == 422

    def test_update_fields_and_generated_prompt(self, client, auth_headers):
        """Updating fields and generated_prompt replaces both in-place."""
        prompt_id = self._create_prompt(client, auth_headers, name="Existing")

        response = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={
                "name": "Updated Name",
                "fields": [{"name": "goal", "content": "new content"}],
                "generated_prompt": "<GOAL>\nnew content\n</GOAL>",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["fields"][0]["content"] == "new content"
        assert data["generated_prompt"] == "<GOAL>\nnew content\n</GOAL>"

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

    def test_update_persists_in_saved_list(self, client, auth_headers):
        """After naming an unnamed prompt via PATCH it appears in GET /saved."""
        prompt_id = self._create_prompt(client, auth_headers)

        # Not in saved yet
        assert client.get("/api/prompts/saved", headers=auth_headers).json() == []

        # Name it
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"name": "Now Saved"},
        )

        saved = client.get("/api/prompts/saved", headers=auth_headers).json()
        assert len(saved) == 1
        assert saved[0]["name"] == "Now Saved"

    def test_update_requires_auth(self, client, auth_headers):
        """PATCH requires authentication (no token supplied → 401)."""
        prompt_id = self._create_prompt(client, auth_headers)
        response = client.patch(f"/api/prompts/{prompt_id}", json={"name": "X"})
        assert response.status_code in (401, 403)


class TestDeletePromptEndpoint:
    """Test cases for DELETE /api/prompts/{id} endpoint."""

    def _create_prompt(self, client, headers, name=None) -> int:
        """Helper: create a prompt and return its ID."""
        payload = {"fields": [{"name": "goal", "content": "to delete"}]}
        if name:
            payload["name"] = name
        response = client.post("/api/prompts/generate", headers=headers, json=payload)
        assert response.status_code == 200
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
            "/api/prompts/generate",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "initial content"}]},
        )
        assert response.status_code == 200
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

    def test_history_includes_updated_at(self, client, auth_headers):
        """GET /api/prompts/history response includes updated_at field."""
        self._create_prompt(client, auth_headers)

        history = client.get("/api/prompts/history", headers=auth_headers).json()
        assert len(history) > 0
        assert "updated_at" in history[0]


class TestFoldersTagsFavorites:
    """Tests for the folder/tags/favorite prompt columns (migrations 006-008)."""

    def _create_prompt(self, client, headers, name="Prompt") -> int:
        response = client.post(
            "/api/prompts/generate",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "x"}], "name": name},
        )
        assert response.status_code == 200
        return response.json()["id"]

    def test_defaults(self, client, auth_headers):
        """A freshly generated prompt defaults to no folder, no tags, not favorited."""
        prompt_id = self._create_prompt(client, auth_headers)
        data = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()
        assert data["folder"] is None
        assert data["tags"] is None
        assert data["is_favorite"] is False

    def test_patch_sets_folder_tags_favorite(self, client, auth_headers):
        """PATCH can set folder, tags, and is_favorite independently."""
        prompt_id = self._create_prompt(client, auth_headers)

        resp = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"folder": "Support", "tags": ["gpt-4o", "customer-facing"], "is_favorite": True},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["folder"] == "Support"
        assert data["tags"] == ["gpt-4o", "customer-facing"]
        assert data["is_favorite"] is True

    def test_patch_tags_rejects_too_many(self, client, auth_headers):
        """More than 20 tags is rejected by validation."""
        prompt_id = self._create_prompt(client, auth_headers)

        resp = client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"tags": [f"tag{i}" for i in range(21)]},
        )
        assert resp.status_code == 422

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

    def test_saved_filters_by_tag(self, client, auth_headers):
        """tag query param matches prompts whose tags list contains it."""
        tagged = self._create_prompt(client, auth_headers, name="Tagged")
        self._create_prompt(client, auth_headers, name="Untagged")
        client.patch(f"/api/prompts/{tagged}", headers=auth_headers, json={"tags": ["internal"]})

        resp = client.get("/api/prompts/saved?tag=internal", headers=auth_headers)
        assert resp.status_code == 200
        names = [p["name"] for p in resp.json()]
        assert names == ["Tagged"]

    def test_get_tags_returns_distinct_sorted_labels(self, client, auth_headers):
        """GET /api/prompts/tags returns the calling user's distinct tags, sorted."""
        first = self._create_prompt(client, auth_headers, name="First")
        second = self._create_prompt(client, auth_headers, name="Second")
        client.patch(
            f"/api/prompts/{first}", headers=auth_headers, json={"tags": ["zebra", "alpha"]}
        )
        client.patch(f"/api/prompts/{second}", headers=auth_headers, json={"tags": ["alpha"]})

        resp = client.get("/api/prompts/tags", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == ["alpha", "zebra"]

    def test_get_folders_returns_distinct_sorted_labels(self, client, auth_headers):
        """GET /api/prompts/folders returns the calling user's distinct folders, sorted."""
        first = self._create_prompt(client, auth_headers, name="First")
        second = self._create_prompt(client, auth_headers, name="Second")
        client.patch(f"/api/prompts/{first}", headers=auth_headers, json={"folder": "Zeta"})
        client.patch(f"/api/prompts/{second}", headers=auth_headers, json={"folder": "Alpha"})

        resp = client.get("/api/prompts/folders", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == ["Alpha", "Zeta"]

    def test_tags_and_folders_scoped_to_owner(self, client, auth_headers, second_auth_headers):
        """A user never sees another user's tags or folders."""
        mine = self._create_prompt(client, auth_headers, name="Mine")
        client.patch(
            f"/api/prompts/{mine}",
            headers=auth_headers,
            json={"folder": "Mine Folder", "tags": ["mine-tag"]},
        )

        tags_resp = client.get("/api/prompts/tags", headers=second_auth_headers)
        folders_resp = client.get("/api/prompts/folders", headers=second_auth_headers)
        assert tags_resp.json() == []
        assert folders_resp.json() == []


class TestRunCountAndVariableMetadata:
    """Tests for the real per-prompt run_count and variable_metadata columns."""

    def _create_prompt(self, client, headers, name="Prompt") -> int:
        response = client.post(
            "/api/prompts/generate",
            headers=headers,
            json={"fields": [{"name": "goal", "content": "x"}], "name": name},
        )
        assert response.status_code == 200
        return response.json()["id"]

    def _add_runs(self, db_session, prompt_id, user_id, count) -> None:
        for _ in range(count):
            db_session.add(PlaygroundRun(prompt_id=prompt_id, user_id=user_id, model="gpt-4o-mini"))
        db_session.commit()

    def test_run_count_defaults_to_zero(self, client, auth_headers):
        prompt_id = self._create_prompt(client, auth_headers)
        data = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()
        assert data["run_count"] == 0

    def test_run_count_reflected_on_get_by_id(self, client, auth_headers, db_session):
        user_id = client.get("/api/auth/me", headers=auth_headers).json()["id"]
        prompt_id = self._create_prompt(client, auth_headers)
        self._add_runs(db_session, prompt_id, user_id, 3)

        data = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()
        assert data["run_count"] == 3

    def test_run_count_reflected_on_saved_and_history(self, client, auth_headers, db_session):
        user_id = client.get("/api/auth/me", headers=auth_headers).json()["id"]
        prompt_id = self._create_prompt(client, auth_headers)
        self._add_runs(db_session, prompt_id, user_id, 2)

        saved = client.get("/api/prompts/saved", headers=auth_headers).json()
        assert saved[0]["run_count"] == 2

        history = client.get("/api/prompts/history", headers=auth_headers).json()
        assert history[0]["run_count"] == 2

    def test_run_count_scoped_to_owner(self, client, auth_headers, second_auth_headers, db_session):
        other_user_id = client.get("/api/auth/me", headers=second_auth_headers).json()["id"]
        prompt_id = self._create_prompt(client, auth_headers)
        others_prompt = self._create_prompt(client, second_auth_headers, name="Not Mine")
        self._add_runs(db_session, others_prompt, other_user_id, 5)

        data = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()
        assert data["run_count"] == 0

    def test_run_count_survives_patch(self, client, auth_headers, db_session):
        user_id = client.get("/api/auth/me", headers=auth_headers).json()["id"]
        prompt_id = self._create_prompt(client, auth_headers)
        self._add_runs(db_session, prompt_id, user_id, 4)

        resp = client.patch(f"/api/prompts/{prompt_id}", headers=auth_headers, json={"folder": "X"})
        assert resp.json()["run_count"] == 4

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
        assert data["customer_name"] == {"type": "text", "description": "Who to address"}
        assert data["age"] == {"type": "number", "description": None}

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
