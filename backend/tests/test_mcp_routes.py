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
        assert tools["get_prompt"]["annotations"]["readOnlyHint"] is True
        assert tools["update_prompt"]["annotations"]["destructiveHint"] is False


class TestMCPPromptTools:
    def test_save_renders_and_stores_a_named_prompt(self, client, auth_headers):
        saved = _ok(client, auth_headers, "save_prompt", name="Summarizer", fields=TASK_FIELDS)

        assert saved["generated_prompt"] == "<TASK>\nSummarize the text\n</TASK>"
        # Same record the website reads, and it lands in the library, not history only.
        rest = client.get("/api/prompts/saved", headers=auth_headers).json()
        assert [p["id"] for p in rest] == [saved["id"]]

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
        versions = _ok(client, auth_headers, "list_prompt_versions", prompt_id=saved["id"])
        assert [(v["note"], v["fields"]) for v in versions["versions"]] == [
            ("Tighter output", TASK_FIELDS)
        ]

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
