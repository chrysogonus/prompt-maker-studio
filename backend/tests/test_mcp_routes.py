"""Tests for the MCP endpoint that exposes the saved-prompt library as tools."""

import pytest

MCP_HEADERS = {"Accept": "application/json, text/event-stream"}
TASK_FIELDS = [{"name": "task", "content": "Summarize the text"}]


@pytest.fixture(autouse=True)
def mcp_uses_test_db(monkeypatch, test_db):
    """The tools open their own sessions, so point them at the per-test database."""
    monkeypatch.setattr("app.api.mcp_routes.SessionLocal", test_db)


def _rpc(client, headers, method, params=None):
    return client.post(
        "/api/mcp",
        headers={**MCP_HEADERS, **headers},
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
    )


def _call(client, headers, tool, **arguments):
    response = _rpc(client, headers, "tools/call", {"name": tool, "arguments": arguments})
    assert response.status_code == 200
    return response.json()["result"]


def _ok(client, headers, tool, **arguments):
    result = _call(client, headers, tool, **arguments)
    assert result["isError"] is False, result["content"]
    return result["structuredContent"]


def _error_text(client, headers, tool, **arguments) -> str:
    result = _call(client, headers, tool, **arguments)
    assert result["isError"] is True
    return result["content"][0]["text"]


class TestMCPAuthentication:
    def test_missing_token_is_rejected(self, client):
        response = _rpc(client, {}, "tools/list")
        assert response.status_code == 401
        assert response.headers["www-authenticate"].startswith("Bearer")

    def test_invalid_token_is_rejected(self, client):
        response = _rpc(client, {"Authorization": "Bearer not-a-jwt"}, "tools/list")
        assert response.status_code == 401

    def test_revoked_token_is_rejected(self, client, auth_headers):
        """Sign-out-everywhere must disconnect MCP clients too."""
        client.post("/api/auth/logout-all", headers=auth_headers)
        assert _rpc(client, auth_headers, "tools/list").status_code == 401

    def test_lists_the_v1_tools(self, client, auth_headers):
        response = _rpc(client, auth_headers, "tools/list")
        tools = {tool["name"]: tool for tool in response.json()["result"]["tools"]}

        assert set(tools) == {
            "list_saved_prompts",
            "get_prompt",
            "save_prompt",
            "update_prompt",
            "list_prompt_versions",
        }
        for name, tool in tools.items():
            annotations = tool["annotations"]
            assert annotations["readOnlyHint"] is (name not in {"save_prompt", "update_prompt"})
            assert annotations["destructiveHint"] is (name == "update_prompt")
            assert annotations["openWorldHint"] is False

    def test_every_tool_has_a_title(self, client, auth_headers):
        """Claude's connector directory rejects tools without a title."""
        response = _rpc(client, auth_headers, "tools/list")
        titles = {tool["name"]: tool.get("title") for tool in response.json()["result"]["tools"]}

        assert titles == {
            "list_saved_prompts": "List saved prompts",
            "get_prompt": "Get prompt",
            "save_prompt": "Save prompt",
            "update_prompt": "Update prompt",
            "list_prompt_versions": "List prompt versions",
        }

    def test_every_tool_annotation_carries_the_title(self, client, auth_headers):
        """Claude's connector directory reads the title from annotations.title, not
        from the tool's top-level title."""
        response = _rpc(client, auth_headers, "tools/list")
        tools = response.json()["result"]["tools"]

        for tool in tools:
            assert tool["annotations"].get("title") == tool["title"], tool["name"]

    def test_version_listing_explains_its_dates(self, client, auth_headers):
        """A version is stored when the next edit replaces it, so its created_at is
        the replacement time; assistants must be told, or they report it as written."""
        response = _rpc(client, auth_headers, "tools/list")
        tools = {tool["name"]: tool for tool in response.json()["result"]["tools"]}
        description = tools["list_prompt_versions"]["description"]

        assert "created_at is when the next edit replaced it" in description
        assert "version 1" in description


class TestMCPPromptTools:
    def test_save_renders_and_stores_a_named_prompt(self, client, auth_headers):
        saved = _ok(client, auth_headers, "save_prompt", name="Summarizer", fields=TASK_FIELDS)

        assert saved["generated_prompt"] == "<TASK>\nSummarize the text\n</TASK>"
        # Same record the website reads, and it lands in the library, not history only.
        rest = client.get("/api/prompts/saved", headers=auth_headers).json()
        assert [p["id"] for p in rest] == [saved["id"]]

    def test_save_accepts_section_names_with_spaces(self, client, auth_headers):
        fields = [{"name": "Output format", "content": "Three bullets"}]
        saved = _ok(client, auth_headers, "save_prompt", name="Spaced", fields=fields)

        assert saved["fields"] == fields
        assert saved["generated_prompt"] == "<OUTPUT_FORMAT>\nThree bullets\n</OUTPUT_FORMAT>"

    def test_save_rejects_duplicate_field_names(self, client, auth_headers):
        text = _error_text(
            client, auth_headers, "save_prompt", name="Dup", fields=TASK_FIELDS + TASK_FIELDS
        )
        assert "unique" in text

    def test_list_and_get_are_scoped_to_the_caller(self, client, auth_headers, second_auth_headers):
        saved = _ok(client, auth_headers, "save_prompt", name="Mine", fields=TASK_FIELDS)

        mine = _ok(client, auth_headers, "list_saved_prompts")["prompts"]
        assert [(p["id"], p["name"]) for p in mine] == [(saved["id"], "Mine")]
        assert _ok(client, second_auth_headers, "list_saved_prompts")["prompts"] == []

        fetched = _ok(client, auth_headers, "get_prompt", prompt_id=saved["id"])
        assert fetched["fields"] == TASK_FIELDS
        assert _error_text(
            client, second_auth_headers, "get_prompt", prompt_id=saved["id"]
        ).endswith("Prompt not found")

    def test_get_returns_input_choices_set_in_the_app(self, client, auth_headers):
        saved = _ok(client, auth_headers, "save_prompt", name="Art", fields=TASK_FIELDS)
        client.patch(
            f"/api/prompts/{saved['id']}",
            headers=auth_headers,
            json={"variable_metadata": {"style": {"type": "text", "options": ["Disney", "Pixar"]}}},
        )

        fetched = _ok(client, auth_headers, "get_prompt", prompt_id=saved["id"])
        assert fetched["variable_metadata"]["style"]["options"] == ["Disney", "Pixar"]

    def test_update_rerenders_text_and_keeps_a_version(self, client, auth_headers):
        saved = _ok(client, auth_headers, "save_prompt", name="Summarizer", fields=TASK_FIELDS)
        new_fields = [{"name": "task", "content": "Summarize in three bullets"}]

        updated = _ok(
            client,
            auth_headers,
            "update_prompt",
            prompt_id=saved["id"],
            last_updated_at=saved["created_at"],
            fields=new_fields,
            note="Tighter output",
        )

        assert updated["generated_prompt"] == "<TASK>\nSummarize in three bullets\n</TASK>"
        assert updated["current_note"] == "Tighter output"
        versions = _ok(client, auth_headers, "list_prompt_versions", prompt_id=saved["id"])
        assert [(v["note"], v["fields"]) for v in versions["versions"]] == [(None, TASK_FIELDS)]

    def test_update_from_a_stale_read_is_rejected(self, client, auth_headers):
        saved = _ok(client, auth_headers, "save_prompt", name="Summarizer", fields=TASK_FIELDS)
        client.patch(f"/api/prompts/{saved['id']}", headers=auth_headers, json={"name": "Renamed"})

        text = _error_text(
            client,
            auth_headers,
            "update_prompt",
            prompt_id=saved["id"],
            last_updated_at=saved["created_at"],
            name="Overwrite",
        )

        assert "modified by another session" in text
        assert client.get(f"/api/prompts/{saved['id']}", headers=auth_headers).json()["name"] == (
            "Renamed"
        )

    def test_cannot_update_another_users_prompt(self, client, auth_headers, second_auth_headers):
        saved = _ok(client, auth_headers, "save_prompt", name="Mine", fields=TASK_FIELDS)

        text = _error_text(
            client,
            second_auth_headers,
            "update_prompt",
            prompt_id=saved["id"],
            last_updated_at=saved["created_at"],
            name="Stolen",
        )

        assert text.endswith("Prompt not found")
