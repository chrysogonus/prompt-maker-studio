"""Revocation must cover access tokens, pending codes and in-flight exchanges."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from functools import partial
import secrets
from threading import Barrier

from mcp.server.auth.provider import TokenError
import pytest

from app.auth.utils import hash_password_reset_token
from app.database.connection import get_db
from app.models.user import User
from app.services.oauth_provider import OAuthProvider
from tests.test_oauth import (
    MCP_HEADERS,
    _approved_code,
    _exchange,
    _link,
    _mcp,
    _pkce,
    _refresh,
    _register,
)


@pytest.fixture(autouse=True)
def oauth_uses_test_db(monkeypatch, test_db):
    monkeypatch.setattr("app.services.oauth_provider.SessionLocal", test_db)
    monkeypatch.setattr("app.api.mcp_routes.SessionLocal", test_db)


def _revoke(client, client_id, token, hint):
    response = client.post(
        "/api/oauth/revoke",
        data={
            "token": token,
            "token_type_hint": hint,
            "client_id": client_id,
            "client_secret": "",
        },
    )
    assert response.status_code == 200


def _library(client, access):
    return client.post(
        "/api/mcp",
        headers={**MCP_HEADERS, "Authorization": f"Bearer {access}"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "list_saved_prompts", "arguments": {}},
        },
    )


@pytest.mark.parametrize("kind", ["access_token", "refresh_token"])
def test_client_revocation_blocks_library_and_pending_codes_without_disconnecting_others(
    client, auth_headers, second_auth_headers, kind
):
    client_id, tokens = _link(client, auth_headers)
    other_id, other_tokens = _link(client, auth_headers)
    # A second account using the same registered client must remain connected.
    verifier, challenge = _pkce()
    code = _approved_code(client, second_auth_headers, client_id, challenge)
    other_user = _exchange(client, client_id, code, verifier).json()
    verifier, challenge = _pkce()
    pending = _approved_code(client, auth_headers, client_id, challenge)
    assert _library(client, tokens["access_token"]).json()["result"]["isError"] is False

    _revoke(client, client_id, tokens[kind], kind)

    assert _library(client, tokens["access_token"]).status_code == 401
    assert _refresh(client, client_id, tokens["refresh_token"]).status_code == 400
    assert _exchange(client, client_id, pending, verifier).status_code == 400
    assert _mcp(client, other_tokens["access_token"]).status_code == 200
    assert _refresh(client, other_id, other_tokens["refresh_token"]).status_code == 200
    assert _mcp(client, other_user["access_token"]).status_code == 200
    assert _refresh(client, client_id, other_user["refresh_token"]).status_code == 200

    # Reconsent must work without reviving previously revoked credentials.
    verifier, challenge = _pkce()
    code = _approved_code(client, auth_headers, client_id, challenge)
    new = _exchange(client, client_id, code, verifier)
    assert new.status_code == 200
    assert _mcp(client, new.json()["access_token"]).status_code == 200
    assert _mcp(client, tokens["access_token"]).status_code == 401


@pytest.mark.parametrize("event", ["logout-all", "change-password", "reset-password"])
def test_pending_codes_cannot_restore_access_after_account_revocation(
    client, auth_headers, db_session, event
):
    client_id = _register(client).json()["client_id"]
    verifier, challenge = _pkce()
    code = _approved_code(client, auth_headers, client_id, challenge)
    if event == "logout-all":
        assert client.post("/api/auth/logout-all", headers=auth_headers).status_code == 204
    elif event == "change-password":
        assert (
            client.post(
                "/api/auth/change-password",
                headers=auth_headers,
                json={"current_password": "testpass123", "new_password": "newpass456"},
            ).status_code
            == 200
        )
    else:
        user = db_session.query(User).filter(User.username == "testuser").one()
        raw = secrets.token_urlsafe(32)
        user.reset_token = hash_password_reset_token(raw)
        user.reset_token_expiry = datetime.now(UTC) + timedelta(hours=1)
        db_session.commit()
        assert (
            client.post(
                "/api/auth/reset-password", json={"token": raw, "new_password": "newpass456"}
            ).status_code
            == 200
        )
    client.cookies.clear()
    assert client.get("/api/auth/me", headers=auth_headers).status_code == 401
    response = _exchange(client, client_id, code, verifier)
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_grant"


@pytest.mark.parametrize("kind", ["code", "refresh"])
@pytest.mark.parametrize("event", ["account", "client"])
def test_revocation_between_validation_and_consumption_rejects_exchange(
    client, auth_headers, kind, event
):
    client_id, tokens = _link(client, auth_headers)
    provider = OAuthProvider()
    info = provider._get_client(client_id)
    if kind == "code":
        _, challenge = _pkce()
        raw = _approved_code(client, auth_headers, client_id, challenge)
        validated = provider._load_code(client_id, raw)
    else:
        validated = provider._load_refresh(client_id, tokens["refresh_token"])
    assert validated is not None
    if event == "account":
        assert client.post("/api/auth/logout-all", headers=auth_headers).status_code == 204
    else:
        _revoke(client, client_id, tokens["access_token"], "access_token")
    if kind == "code":
        exchange = partial(provider._exchange_code, info, validated)
    else:
        exchange = partial(provider._rotate_refresh, info, validated, [])
    with pytest.raises(TokenError) as error:
        exchange()
    assert error.value.error == "invalid_grant"


@pytest.mark.parametrize("kind", ["code", "refresh"])
def test_revocation_after_commit_cannot_upgrade_the_access_token_version(
    client, auth_headers, test_db, monkeypatch, kind
):
    client_id, tokens = _link(client, auth_headers)
    verifier, challenge = _pkce()
    code = _approved_code(client, auth_headers, client_id, challenge)

    def session_with_revocation_after_commit():
        session = test_db()
        commit = session.commit

        def commit_then_revoke():
            commit()
            with test_db() as revoker:
                revoker.query(User).filter(User.username == "testuser").update(
                    {User.token_version: User.token_version + 1}
                )
                revoker.commit()

        session.commit = commit_then_revoke
        return session

    monkeypatch.setattr(
        "app.services.oauth_provider.SessionLocal", session_with_revocation_after_commit
    )
    response = (
        _exchange(client, client_id, code, verifier)
        if kind == "code"
        else _refresh(client, client_id, tokens["refresh_token"])
    )
    assert response.status_code == 200
    assert _mcp(client, response.json()["access_token"]).status_code == 401


@pytest.mark.parametrize("kind", ["code", "refresh"])
def test_concurrent_consumption_issues_only_one_token_pair(client, auth_headers, kind):
    client_id, tokens = _link(client, auth_headers)
    provider = OAuthProvider()
    info = provider._get_client(client_id)
    if kind == "code":
        _, challenge = _pkce()
        raw = _approved_code(client, auth_headers, client_id, challenge)
        validated = provider._load_code(client_id, raw)
    else:
        validated = provider._load_refresh(client_id, tokens["refresh_token"])
    barrier = Barrier(2)

    def exchange():
        barrier.wait(timeout=5)
        try:
            if kind == "code":
                return provider._exchange_code(info, validated)
            return provider._rotate_refresh(info, validated, [])
        except TokenError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: exchange(), range(2)))
    successful = [result for result in results if result is not None]
    assert len(successful) == 1
    assert _mcp(client, successful[0].access_token).status_code == 200


@pytest.mark.parametrize("event", ["logout-all", "change-password", "reset-password"])
def test_overlapping_account_revocations_cannot_reuse_a_version(
    client, auth_headers, db_session, event, monkeypatch
):
    from app.auth.dependencies import get_current_user
    from app.auth.utils import create_access_token
    from app.main import app

    # Stage an already authenticated request with the original version cached.
    stale_user = db_session.query(User).filter(User.username == "testuser").one()
    raw = secrets.token_urlsafe(32)
    stale_user.reset_token = hash_password_reset_token(raw)
    stale_user.reset_token_expiry = datetime.now(UTC) + timedelta(hours=1)
    db_session.commit()
    assert stale_user.token_version == 0
    assert client.post("/api/auth/logout-all", headers=auth_headers).status_code == 204
    current_headers = {
        "Authorization": f"Bearer {create_access_token(stale_user.auth_subject, token_version=1)}"
    }
    _, tokens = _link(client, current_headers)
    assert _mcp(client, tokens["access_token"]).status_code == 200

    with monkeypatch.context() as overrides:
        # The earlier request resumes after a different revocation and reconnect.
        overrides.setitem(app.dependency_overrides, get_current_user, lambda: stale_user)
        overrides.setitem(app.dependency_overrides, get_db, lambda: db_session)
        if event == "logout-all":
            response = client.post("/api/auth/logout-all", headers=auth_headers)
            assert response.status_code == 204
        elif event == "change-password":
            response = client.post(
                "/api/auth/change-password",
                headers=auth_headers,
                json={"current_password": "testpass123", "new_password": "newpass456"},
            )
            assert response.status_code == 200
        else:
            response = client.post(
                "/api/auth/reset-password", json={"token": raw, "new_password": "newpass456"}
            )
            assert response.status_code == 200
        assert _mcp(client, tokens["access_token"]).status_code == 401


def test_legacy_access_token_without_grant_version_is_rejected(client, auth_headers):
    import jwt

    from app.auth.utils import ALGORITHM, SECRET_KEY
    from app.services.oauth_provider import RESOURCE_URL

    _, tokens = _link(client, auth_headers)
    payload = jwt.decode(
        tokens["access_token"], SECRET_KEY, algorithms=[ALGORITHM], audience=RESOURCE_URL
    )
    payload.pop("gv")
    legacy = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    assert _mcp(client, legacy).status_code == 401


def test_consent_cannot_adopt_a_version_revoked_after_authentication(
    client, auth_headers, db_session, monkeypatch
):
    from app.auth.dependencies import get_current_user
    from app.main import app
    from tests.test_oauth import _pending_request

    client_id = _register(client).json()["client_id"]
    _, challenge = _pkce()
    pending = _pending_request(client, client_id, challenge)
    stale_user = db_session.query(User).filter(User.username == "testuser").one()
    assert stale_user.token_version == 0
    assert client.post("/api/auth/logout-all", headers=auth_headers).status_code == 204
    with monkeypatch.context() as overrides:
        overrides.setitem(app.dependency_overrides, get_current_user, lambda: stale_user)
        overrides.setitem(app.dependency_overrides, get_db, lambda: db_session)
        response = client.post(
            "/api/oauth/consent", headers=auth_headers, json={"request": pending, "approve": True}
        )
        assert response.status_code == 401


@pytest.mark.parametrize("kind", ["access", "refresh"])
@pytest.mark.parametrize("replacement", ["reconnect", "account"])
def test_delayed_revocation_cannot_disconnect_a_replacement_grant(
    client, auth_headers, db_session, kind, replacement
):
    from tests.conftest import _register_and_connect

    client_id, tokens = _link(client, auth_headers)
    provider = OAuthProvider()
    delayed = (
        provider._load_access(tokens["access_token"])
        if kind == "access"
        else provider._load_refresh(client_id, tokens["refresh_token"])
    )
    assert delayed is not None
    if replacement == "account":
        old_id = int(delayed.subject)
        assert (
            client.request(
                "DELETE",
                "/api/auth/me",
                headers=auth_headers,
                json={"current_password": "testpass123"},
            ).status_code
            == 204
        )
        auth_headers = _register_and_connect(
            client, "replacement", "testpass123", "replacement@example.com"
        )
        assert db_session.query(User.id).filter(User.username == "replacement").scalar() == old_id
    else:
        _revoke(client, client_id, tokens["access_token"], "access_token")
    verifier, challenge = _pkce()
    code = _approved_code(client, auth_headers, client_id, challenge)
    new = _exchange(client, client_id, code, verifier).json()
    assert _mcp(client, new["access_token"]).status_code == 200

    provider._revoke(delayed)

    assert _mcp(client, new["access_token"]).status_code == 200
    assert _refresh(client, client_id, new["refresh_token"]).status_code == 200


@pytest.mark.parametrize("replacement", ["reconnect", "account"])
def test_access_revocation_rechecks_identity_and_generation_atomically(
    client, auth_headers, db_session, monkeypatch, replacement
):
    from app.services import oauth_provider
    from tests.conftest import _register_and_connect

    client_id, tokens = _link(client, auth_headers)
    provider = OAuthProvider()
    delayed = provider._load_access(tokens["access_token"])
    resolve = oauth_provider.user_from_mcp_access_token
    new = {}
    triggered = False

    def resolve_then_replace(raw, db):
        nonlocal triggered
        resolved = resolve(raw, db)
        if not triggered:
            triggered = True
            headers = auth_headers
            if replacement == "account":
                old_id = int(delayed.subject)
                response = client.request(
                    "DELETE",
                    "/api/auth/me",
                    headers=headers,
                    json={"current_password": "testpass123"},
                )
                assert response.status_code == 204
                headers = _register_and_connect(
                    client, "replacement", "testpass123", "replacement@example.com"
                )
                assert (
                    db_session.query(User.id).filter(User.username == "replacement").scalar()
                    == old_id
                )
            else:
                _revoke(client, client_id, tokens["access_token"], "access_token")
            verifier, challenge = _pkce()
            code = _approved_code(client, headers, client_id, challenge)
            new.update(_exchange(client, client_id, code, verifier).json())
        return resolved

    monkeypatch.setattr(oauth_provider, "user_from_mcp_access_token", resolve_then_replace)
    provider._revoke(delayed)
    assert triggered
    assert _mcp(client, new["access_token"]).status_code == 200
    assert _refresh(client, client_id, new["refresh_token"]).status_code == 200
