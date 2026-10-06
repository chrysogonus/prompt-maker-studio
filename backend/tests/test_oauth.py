"""Tests for OAuth account linking of MCP clients (ChatGPT and others)."""

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlparse

import pytest

from app.services.oauth_provider import ISSUER_URL, PUBLIC_URL, RESOURCE_URL

CHATGPT_REDIRECT = "https://chatgpt.com/connector/oauth/test-callback"
MCP_HEADERS = {"Accept": "application/json, text/event-stream"}
TOOLS_LIST = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}


@pytest.fixture(autouse=True)
def oauth_uses_test_db(monkeypatch, test_db):
    """The OAuth provider and MCP tools open their own sessions."""
    monkeypatch.setattr("app.services.oauth_provider.SessionLocal", test_db)
    monkeypatch.setattr("app.api.mcp_routes.SessionLocal", test_db)


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _register(client, redirect_uri=CHATGPT_REDIRECT):
    return client.post(
        "/api/oauth/register",
        json={
            "client_name": "ChatGPT",
            "redirect_uris": [redirect_uri],
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        },
    )


def _authorize(client, client_id, challenge, redirect_uri=CHATGPT_REDIRECT, **extra):
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "state-123",
        "resource": RESOURCE_URL,
        **extra,
    }
    return client.get("/api/oauth/authorize", params=params, follow_redirects=False)


def _pending_request(client, client_id, challenge) -> str:
    response = _authorize(client, client_id, challenge)
    assert response.status_code == 302, response.text
    location = urlparse(response.headers["location"])
    assert (
        f"{location.scheme}://{location.netloc}{location.path}" == f"{PUBLIC_URL}/oauth/authorize"
    )
    return parse_qs(location.query)["request"][0]


def _approve(client, headers, request: str) -> dict:
    response = client.post(
        "/api/oauth/consent", headers=headers, json={"request": request, "approve": True}
    )
    assert response.status_code == 200, response.text
    redirect = urlparse(response.json()["redirect_url"])
    assert f"{redirect.scheme}://{redirect.netloc}{redirect.path}" == CHATGPT_REDIRECT
    return {k: v[0] for k, v in parse_qs(redirect.query).items()}


def _approved_code(client, headers, client_id, challenge) -> str:
    return _approve(client, headers, _pending_request(client, client_id, challenge))["code"]


def _exchange(client, client_id, code, verifier):
    return client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": CHATGPT_REDIRECT,
            "client_id": client_id,
            "code_verifier": verifier,
            "resource": RESOURCE_URL,
        },
    )


def _refresh(client, client_id, refresh_token):
    return client.post(
        "/api/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
        },
    )


def _link(client, headers) -> tuple[str, dict]:
    """Run the full flow; return the client id and the token response."""
    client_id = _register(client).json()["client_id"]
    verifier, challenge = _pkce()
    query = _approve(client, headers, _pending_request(client, client_id, challenge))
    tokens = _exchange(client, client_id, query["code"], verifier)
    assert tokens.status_code == 200, tokens.text
    return client_id, tokens.json()


def _mcp(client, token):
    return client.post(
        "/api/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"}, json=TOOLS_LIST
    )


class TestDiscovery:
    def test_unauthenticated_mcp_call_points_to_resource_metadata(self, client):
        response = client.post("/api/mcp", headers=MCP_HEADERS, json=TOOLS_LIST)
        assert response.status_code == 401
        assert (
            'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"'
            in response.headers["www-authenticate"]
        )

    def test_protected_resource_metadata_names_this_issuer(self, client):
        metadata = client.get("/.well-known/oauth-protected-resource/api/mcp").json()
        assert metadata["resource"] == RESOURCE_URL
        assert metadata["authorization_servers"] == [ISSUER_URL]

    def test_authorization_server_metadata_at_rfc8414_path(self, client):
        metadata = client.get("/.well-known/oauth-authorization-server/api/oauth").json()
        assert metadata["issuer"] == ISSUER_URL
        assert metadata["authorization_endpoint"] == f"{ISSUER_URL}/authorize"
        assert metadata["token_endpoint"] == f"{ISSUER_URL}/token"
        assert metadata["registration_endpoint"] == f"{ISSUER_URL}/register"
        assert "S256" in metadata["code_challenge_methods_supported"]


class TestRegistration:
    def test_chatgpt_redirect_is_accepted(self, client):
        response = _register(client)
        assert response.status_code == 201
        assert response.json()["client_id"]

    def test_loopback_redirect_is_accepted(self, client):
        assert _register(client, "http://localhost:6274/oauth/callback").status_code == 201

    def test_unlisted_host_is_rejected(self, client):
        response = _register(client, "https://evil.example/callback")
        assert response.status_code == 400
        assert response.json()["error"] == "invalid_redirect_uri"

    def test_plain_http_to_an_allowed_host_is_rejected(self, client):
        assert _register(client, "http://chatgpt.com/callback").status_code == 400

    def test_extra_hosts_can_be_allowed(self, client, monkeypatch):
        monkeypatch.setenv("OAUTH_REDIRECT_HOSTS", "chatgpt.com, claude.ai")
        assert _register(client, "https://claude.ai/api/mcp/auth_callback").status_code == 201


class TestAuthorizationFlow:
    def test_linked_token_reaches_mcp_tools(self, client, auth_headers):
        _, tokens = _link(client, auth_headers)

        assert tokens["token_type"].lower() == "bearer"
        assert tokens["expires_in"] == 3600
        response = _mcp(client, tokens["access_token"])
        assert response.status_code == 200
        assert len(response.json()["result"]["tools"]) == 5

    def test_state_is_returned_to_the_client(self, client, auth_headers):
        client_id = _register(client).json()["client_id"]
        _, challenge = _pkce()
        query = _approve(client, auth_headers, _pending_request(client, client_id, challenge))
        assert query["state"] == "state-123"

    def test_consent_details_name_the_client(self, client, auth_headers):
        client_id = _register(client).json()["client_id"]
        _, challenge = _pkce()
        request = _pending_request(client, client_id, challenge)

        details = client.get(
            "/api/oauth/consent", params={"request": request}, headers=auth_headers
        ).json()

        assert details == {"client_name": "ChatGPT", "redirect_host": "chatgpt.com"}

    def test_consent_requires_sign_in(self, client):
        client_id = _register(client).json()["client_id"]
        _, challenge = _pkce()
        request = _pending_request(client, client_id, challenge)
        response = client.post("/api/oauth/consent", json={"request": request, "approve": True})
        assert response.status_code == 401

    def test_tampered_request_is_rejected(self, client, auth_headers):
        response = client.post(
            "/api/oauth/consent",
            headers=auth_headers,
            json={"request": "not-a-signed-request", "approve": True},
        )
        assert response.status_code == 400

    def test_denial_redirects_with_access_denied(self, client, auth_headers):
        client_id = _register(client).json()["client_id"]
        _, challenge = _pkce()
        request = _pending_request(client, client_id, challenge)

        response = client.post(
            "/api/oauth/consent", headers=auth_headers, json={"request": request, "approve": False}
        )

        query = parse_qs(urlparse(response.json()["redirect_url"]).query)
        assert query["error"] == ["access_denied"]
        assert query["state"] == ["state-123"]
        assert "code" not in query

    def test_foreign_resource_is_refused(self, client):
        client_id = _register(client).json()["client_id"]
        _, challenge = _pkce()
        response = _authorize(client, client_id, challenge, resource="https://other.example/mcp")
        error = parse_qs(urlparse(response.headers["location"]).query)["error"]
        assert error == ["invalid_request"]

    def test_code_is_single_use(self, client, auth_headers):
        client_id = _register(client).json()["client_id"]
        verifier, challenge = _pkce()
        code = _approved_code(client, auth_headers, client_id, challenge)

        assert _exchange(client, client_id, code, verifier).status_code == 200
        second = _exchange(client, client_id, code, verifier)
        assert second.status_code == 400
        assert second.json()["error"] == "invalid_grant"

    def test_wrong_pkce_verifier_is_rejected(self, client, auth_headers):
        client_id = _register(client).json()["client_id"]
        _, challenge = _pkce()
        code = _approved_code(client, auth_headers, client_id, challenge)

        response = _exchange(client, client_id, code, "a-different-verifier-" + "x" * 30)

        assert response.status_code == 400
        assert response.json()["error"] == "invalid_grant"

    def test_code_cannot_be_redeemed_by_another_client(self, client, auth_headers):
        client_id = _register(client).json()["client_id"]
        other_client = _register(client).json()["client_id"]
        verifier, challenge = _pkce()
        code = _approved_code(client, auth_headers, client_id, challenge)

        assert _exchange(client, other_client, code, verifier).status_code == 400


class TestTokens:
    def test_access_token_cannot_call_the_rest_api(self, client, auth_headers):
        """An access token issued to ChatGPT is for the MCP endpoint only."""
        _, tokens = _link(client, auth_headers)
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        assert client.get("/api/prompts/saved", headers=headers).status_code == 401
        assert client.get("/api/auth/me", headers=headers).status_code == 401

    def test_access_token_acts_as_the_approving_user(
        self, client, auth_headers, second_auth_headers
    ):
        client.post(
            "/api/prompts/generate",
            headers=second_auth_headers,
            json={"name": "Not yours", "fields": [{"name": "task", "content": "x"}]},
        )
        _, tokens = _link(client, auth_headers)

        response = client.post(
            "/api/mcp",
            headers={**MCP_HEADERS, "Authorization": f"Bearer {tokens['access_token']}"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "list_saved_prompts", "arguments": {}},
            },
        )

        assert response.json()["result"]["structuredContent"] == {"prompts": []}

    def test_refresh_rotates_the_refresh_token(self, client, auth_headers):
        client_id, tokens = _link(client, auth_headers)

        refreshed = _refresh(client, client_id, tokens["refresh_token"])
        assert refreshed.status_code == 200
        new = refreshed.json()
        assert new["refresh_token"] != tokens["refresh_token"]
        assert _mcp(client, new["access_token"]).status_code == 200

        reused = _refresh(client, client_id, tokens["refresh_token"])
        assert reused.status_code == 400
        assert reused.json()["error"] == "invalid_grant"

    def test_sign_out_everywhere_disconnects_the_client(self, client, auth_headers):
        client_id, tokens = _link(client, auth_headers)

        client.post("/api/auth/logout-all", headers=auth_headers)

        assert _mcp(client, tokens["access_token"]).status_code == 401
        assert _refresh(client, client_id, tokens["refresh_token"]).status_code == 400

    def test_revoking_the_refresh_token_ends_the_connection(self, client, auth_headers):
        client_id, tokens = _link(client, auth_headers)

        # The SDK's revocation form requires a client_secret field even for a
        # public client, so it is sent empty.
        revoked = client.post(
            "/api/oauth/revoke",
            data={"token": tokens["refresh_token"], "client_id": client_id, "client_secret": ""},
        )

        assert revoked.status_code == 200
        assert _refresh(client, client_id, tokens["refresh_token"]).status_code == 400

    def test_account_deletion_removes_oauth_grants(self, client, auth_headers, db_session):
        from app.models.oauth import OAuthRefreshToken

        _link(client, auth_headers)
        assert db_session.query(OAuthRefreshToken).count() == 1

        client.request(
            "DELETE",
            "/api/auth/me",
            headers=auth_headers,
            json={"current_password": "testpass123"},
        )

        assert db_session.query(OAuthRefreshToken).count() == 0
