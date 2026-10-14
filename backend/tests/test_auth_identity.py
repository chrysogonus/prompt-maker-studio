"""Account identity and password input regressions shared across authentication paths."""

from uuid import UUID

import bcrypt
import jwt
import pytest

from app.auth.dependencies import user_from_token
from app.auth.utils import (
    ALGORITHM,
    SECRET_KEY,
    create_access_token,
    get_password_hash,
    verify_password,
)
from app.models.user import User
from app.schemas.accounts import ChangePasswordRequest, ResetPasswordRequest, UserCreate
from app.services.oauth_provider import (
    RESOURCE_URL,
    create_mcp_access_token,
    user_from_mcp_access_token,
)


def _account(client, username="original", email="original@example.com"):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": "password123"},
    )
    assert response.status_code == 201
    assert (
        client.post(
            "/api/auth/login", json={"username": username, "password": "password123"}
        ).status_code
        == 200
    )
    token = client.cookies["access_token"]
    client.cookies.clear()
    return response.json()["id"], token


@pytest.mark.parametrize("transport", ["session", "mcp"])
@pytest.mark.parametrize("replacement", ["rename", "delete"])
def test_tokens_never_authenticate_a_replacement_account(
    client, db_session, transport, replacement
):
    user_id, session = _account(client)
    user = db_session.get(User, user_id)
    token = session if transport == "session" else create_mcp_access_token(user, "client")
    headers = {"Authorization": f"Bearer {session}"}
    if replacement == "rename":
        assert (
            client.patch(
                "/api/auth/me", json={"new_username": "renamed"}, headers=headers
            ).status_code
            == 200
        )
    else:
        assert (
            client.request(
                "DELETE", "/api/auth/me", json={"current_password": "password123"}, headers=headers
            ).status_code
            == 204
        )
    replacement_id, _ = _account(client, email="replacement@example.com")
    db_session.expire_all()
    resolved = (
        user_from_token(token, db_session)
        if transport == "session"
        else user_from_mcp_access_token(token, db_session)
    )
    if replacement == "rename":
        owner = resolved if transport == "session" else resolved[0]
        assert owner.id == user_id
        assert owner.username == "renamed"
        assert owner.id != replacement_id
    else:
        # SQLite can reuse integer primary keys; the token must still stay dead.
        assert replacement_id == user_id
        assert resolved is None


@pytest.mark.parametrize("transport", ["session", "mcp"])
def test_legacy_username_subjects_require_reauthentication(client, db_session, transport):
    user_id, _ = _account(client)
    user = db_session.get(User, user_id)
    if transport == "session":
        token = create_access_token(user.username)
        assert user_from_token(token, db_session) is None
    else:
        token = create_mcp_access_token(user, "client")
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=RESOURCE_URL)
        payload["sub"] = user.username
        legacy = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
        assert user_from_mcp_access_token(legacy, db_session) is None


def test_session_subject_is_an_opaque_uuid(client):
    _, token = _account(client)
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    assert UUID(payload["sub"]).version == 4


@pytest.mark.parametrize(("password", "prefix"), [("é" * 37, "é" * 36), ("a" * 73, "a" * 72)])
def test_password_verification_rejects_inputs_over_72_bytes(password, prefix):
    assert verify_password(password, get_password_hash(prefix)) is False


@pytest.mark.parametrize(
    ("schema", "values"),
    [
        (UserCreate, {"username": "user", "email": "user@example.com", "password": "é" * 37}),
        (ResetPasswordRequest, {"token": "token", "new_password": "é" * 37}),
        (ChangePasswordRequest, {"current_password": "password123", "new_password": "é" * 37}),
    ],
)
def test_new_password_schemas_enforce_bcrypt_byte_limit(schema, values):
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="72 UTF-8 bytes"):
        schema(**values)


@pytest.mark.parametrize("operation", ["login", "delete", "change"])
def test_overlength_existing_passwords_are_rejected_without_server_errors(client, operation):
    _, token = _account(client)
    password = "é" * 37
    headers = {"Authorization": f"Bearer {token}"}
    if operation == "login":
        response = client.post(
            "/api/auth/login", json={"username": "original", "password": password}
        )
    elif operation == "delete":
        response = client.request(
            "DELETE", "/api/auth/me", headers=headers, json={"current_password": password}
        )
    else:
        response = client.post(
            "/api/auth/change-password",
            headers=headers,
            json={"current_password": password, "new_password": "password456"},
        )
    assert response.status_code == 401


def test_unicode_password_at_72_bytes_can_register_and_login(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "unicode", "email": "unicode@example.com", "password": "é" * 36},
    )
    assert response.status_code == 201
    assert (
        client.post(
            "/api/auth/login", json={"username": "unicode", "password": "é" * 36}
        ).status_code
        == 200
    )


def test_duplicate_registration_does_not_disclose_the_conflicting_field(client):
    _account(client)
    username_conflict = client.post(
        "/api/auth/register",
        json={"username": "original", "email": "new@example.com", "password": "password123"},
    )
    email_conflict = client.post(
        "/api/auth/register",
        json={"username": "different", "email": "original@example.com", "password": "password123"},
    )
    assert username_conflict.status_code == email_conflict.status_code == 400
    assert username_conflict.json() == email_conflict.json()


def test_unknown_username_performs_bcrypt_verification(client, monkeypatch):
    checked = []
    checkpw = bcrypt.checkpw

    def record_check(password, hashed):
        checked.append(password)
        return checkpw(password, hashed)

    monkeypatch.setattr(bcrypt, "checkpw", record_check)
    response = client.post(
        "/api/auth/login", json={"username": "unknown", "password": "password123"}
    )
    assert response.status_code == 401
    assert checked == [b"password123"]
