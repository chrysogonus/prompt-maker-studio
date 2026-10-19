"""Listing and disconnecting the MCP clients (such as ChatGPT) linked to an account."""

import pytest

from tests.test_oauth import _link, _mcp, _refresh


@pytest.fixture(autouse=True)
def oauth_uses_test_db(monkeypatch, test_db):
    monkeypatch.setattr("app.services.oauth_provider.SessionLocal", test_db)
    monkeypatch.setattr("app.api.mcp_routes.SessionLocal", test_db)


def test_lists_a_linked_client_and_disconnects_it_at_once(client, auth_headers):
    assert client.get("/api/auth/me/connected-apps", headers=auth_headers).json() == []
    client_id, tokens = _link(client, auth_headers)
    assert client.get("/api/auth/me/connected-apps", headers=auth_headers).json() == [
        {"client_id": client_id, "name": "ChatGPT"}
    ]
    assert _mcp(client, tokens["access_token"]).status_code == 200

    response = client.delete(f"/api/auth/me/connected-apps/{client_id}", headers=auth_headers)

    assert response.status_code == 204
    assert client.get("/api/auth/me/connected-apps", headers=auth_headers).json() == []
    # Tokens already issued stop working immediately.
    assert _mcp(client, tokens["access_token"]).status_code == 401
    assert _refresh(client, client_id, tokens["refresh_token"]).status_code == 400


def test_other_accounts_connections_are_neither_listed_nor_disconnectable(
    client, auth_headers, second_auth_headers
):
    client_id, tokens = _link(client, second_auth_headers)
    assert client.get("/api/auth/me/connected-apps", headers=auth_headers).json() == []
    response = client.delete(f"/api/auth/me/connected-apps/{client_id}", headers=auth_headers)
    assert response.status_code == 404
    assert _mcp(client, tokens["access_token"]).status_code == 200


def test_sign_out_everywhere_empties_the_list(client, auth_headers):
    _link(client, auth_headers)
    assert client.post("/api/auth/logout-all", headers=auth_headers).status_code == 204
    client.post("/api/auth/login", json={"username": "testuser", "password": "testpass123!"})
    headers = {"Authorization": f"Bearer {client.cookies['access_token']}"}
    client.cookies.clear()
    assert client.get("/api/auth/me/connected-apps", headers=headers).json() == []


def test_requires_authentication_and_a_valid_client_id(client, auth_headers):
    assert client.get("/api/auth/me/connected-apps").status_code == 401
    assert client.delete("/api/auth/me/connected-apps/abc").status_code == 401
    too_long = "x" * 65
    assert (
        client.delete(f"/api/auth/me/connected-apps/{too_long}", headers=auth_headers).status_code
        == 422
    )
