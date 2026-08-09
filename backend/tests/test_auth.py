"""
Tests for authentication functionality.
"""

from datetime import UTC, datetime, timedelta
import secrets

from fastapi import status
import jwt
import pytest

from app import main
from app.auth.cookies import CSRF_COOKIE_NAME, CSRF_HEADER_NAME
from app.auth.utils import (
    ALGORITHM,
    SECRET_KEY,
    create_access_token,
    decode_access_token,
    get_password_hash,
    is_insecure_secret_key,
    verify_password,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _register_and_login(
    client, *, username: str = "testuser", password: str = "testpass123", email: str | None = None
) -> str:
    """Register a user and return a valid JWT access token."""
    if email is None:
        email = f"{username.strip().lower()}@example.com"
    client.post(
        "/api/auth/register", json={"username": username, "password": password, "email": email}
    )
    client.post("/api/auth/login", json={"username": username, "password": password})
    # Login now delivers the token as an httpOnly cookie. Tests that want to
    # drive the bearer path read it out and empty the jar, so the cookie does
    # not authenticate (and demand CSRF on) their subsequent requests.
    token = client.cookies["access_token"]
    client.cookies.clear()
    return token


# ---------------------------------------------------------------------------
# Unit tests for auth utility functions
# ---------------------------------------------------------------------------


def test_password_hashing():
    """Test password hashing and verification."""
    password = "testpassword123"
    hashed = get_password_hash(password)

    # Verify correct password
    assert verify_password(password, hashed)

    # Verify incorrect password
    assert not verify_password("wrongpassword", hashed)


def test_register_user(client):
    """Test user registration endpoint."""
    response = client.post(
        "/api/auth/register",
        json={"username": "testuser", "password": "testpass123", "email": "testuser@example.com"},
    )

    assert response.status_code == status.HTTP_201_CREATED
    data = response.json()
    assert data["username"] == "testuser"
    assert "id" in data
    assert "created_at" in data
    assert "password" not in data  # Password should not be returned


def test_register_duplicate_user(client):
    """Test registering a user with an existing username."""
    # Register first user
    client.post(
        "/api/auth/register",
        json={"username": "duplicate", "password": "testpass123", "email": "dup@example.com"},
    )

    # Try to register again with same username
    response = client.post(
        "/api/auth/register",
        json={"username": "duplicate", "password": "differentpass", "email": "dup2@example.com"},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "already registered" in response.json()["detail"].lower()


def test_register_duplicate_email(client):
    """Test registering a user with an existing email."""
    # Register first user
    client.post(
        "/api/auth/register",
        json={"username": "user1", "password": "testpass123", "email": "same@example.com"},
    )

    # Try to register again with same email but different username
    response = client.post(
        "/api/auth/register",
        json={"username": "user2", "password": "differentpass", "email": "same@example.com"},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "email address already registered" in response.json()["detail"].lower()


def test_register_requires_email(client):
    """Registration without an email address is rejected with 422."""
    response = client.post(
        "/api/auth/register",
        json={"username": "noemail", "password": "testpass123"},
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_login_success(client):
    """Test successful user login."""
    # Register user first
    client.post(
        "/api/auth/register",
        json={"username": "loginuser", "password": "testpass123", "email": "loginuser@example.com"},
    )

    # Login
    response = client.post(
        "/api/auth/login",
        json={"username": "loginuser", "password": "testpass123"},
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    # The token is in the cookie, never the body.
    assert "access_token" not in data
    assert client.cookies["access_token"]
    assert data["token_type"] == "bearer"
    assert data["expires_at"]


def test_refresh_access_token_keeps_authenticated_session(client):
    """A valid bearer token can be renewed without resubmitting credentials."""
    token = _register_and_login(client, username="refreshuser", password="testpass123")

    response = client.post(
        "/api/auth/refresh",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == status.HTTP_200_OK
    refreshed_token = client.cookies["access_token"]
    client.cookies.clear()
    me_response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {refreshed_token}"},
    )
    assert me_response.status_code == status.HTTP_200_OK
    assert me_response.json()["username"] == "refreshuser"


def test_refresh_access_token_requires_valid_auth(client):
    """Missing and expired credentials cannot be exchanged for a new token."""
    missing_response = client.post("/api/auth/refresh")
    assert missing_response.status_code == status.HTTP_401_UNAUTHORIZED

    _register_and_login(client, username="expiredrefresh", password="testpass123")
    expired_token = create_access_token(
        subject="expiredrefresh",
        expires_delta=timedelta(seconds=-10),
    )
    expired_response = client.post(
        "/api/auth/refresh",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert expired_response.status_code == status.HTTP_401_UNAUTHORIZED


def test_login_wrong_password(client):
    """Test login with incorrect password."""
    # Register user
    client.post(
        "/api/auth/register",
        json={"username": "wrongpass", "password": "correctpass", "email": "wrongpass@example.com"},
    )

    # Try login with wrong password
    response = client.post(
        "/api/auth/login",
        json={"username": "wrongpass", "password": "wrongpassword"},
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_login_nonexistent_user(client):
    """Test login with non-existent username."""
    response = client.post(
        "/api/auth/login",
        json={"username": "nonexistent", "password": "anypassword"},
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_get_current_user(client):
    """Test getting current user information."""
    # Register and login
    client.post(
        "/api/auth/register",
        json={
            "username": "currentuser",
            "password": "testpass123",
            "email": "currentuser@example.com",
        },
    )

    client.post(
        "/api/auth/login",
        json={"username": "currentuser", "password": "testpass123"},
    )
    token = client.cookies["access_token"]
    client.cookies.clear()

    # Get current user info
    response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["username"] == "currentuser"


def test_protected_endpoint_without_auth(client):
    """Test accessing protected prompt endpoint without authentication."""
    response = client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "test", "content": "test content"}]},
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_protected_endpoint_with_auth(client):
    """Test accessing protected prompt endpoint with authentication."""
    # Register and login
    client.post(
        "/api/auth/register",
        json={
            "username": "promptuser",
            "password": "testpass123",
            "email": "promptuser@example.com",
        },
    )

    client.post(
        "/api/auth/login",
        json={"username": "promptuser", "password": "testpass123"},
    )
    token = client.cookies["access_token"]
    client.cookies.clear()

    # Generate prompt with authentication
    response = client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "goal", "content": "test content"}]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert "generated_prompt" in data


def test_protected_endpoint_with_invalid_token(client):
    """Test accessing protected endpoint with invalid token."""
    response = client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "test", "content": "test content"}]},
        headers={"Authorization": "Bearer invalid_token"},
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# Token utility round-trip
# ---------------------------------------------------------------------------


def test_create_and_decode_access_token():
    """Test that a created token can be decoded and contains the correct subject."""
    token = create_access_token(subject="roundtripuser")
    payload = decode_access_token(token)

    assert payload is not None
    assert payload["sub"] == "roundtripuser"


def test_decode_returns_none_for_garbage_token():
    """Test that decode_access_token returns None for an obviously invalid token."""
    assert decode_access_token("not.a.valid.jwt") is None


# ---------------------------------------------------------------------------
# Expired and malformed token tests
# ---------------------------------------------------------------------------


def test_expired_token_is_rejected(client):
    """Test that an already-expired token is rejected with 401."""
    _register_and_login(client, username="expireduser", password="testpass123")

    expired_token = create_access_token(
        subject="expireduser",
        expires_delta=timedelta(seconds=-10),
    )

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_token_allows_bounded_clock_skew():
    """A just-issued token survives a small backward host-clock correction."""
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": "clock-skew-user",
            "iat": now + timedelta(seconds=3),
            "exp": now + timedelta(minutes=30),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )

    assert decode_access_token(token)["sub"] == "clock-skew-user"


def test_token_rejects_issue_time_beyond_clock_skew():
    """The bounded tolerance must not admit materially future-dated tokens."""
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": "future-user",
            "iat": now + timedelta(seconds=30),
            "exp": now + timedelta(minutes=30),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )

    assert decode_access_token(token) is None


def test_token_missing_sub_claim_is_rejected(client):
    """Test that a valid JWT without a 'sub' claim is rejected with 401."""
    token = jwt.encode(
        {"exp": datetime.now(UTC) + timedelta(minutes=30)},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# Password validation boundary tests
# ---------------------------------------------------------------------------


def test_register_password_too_short_is_rejected(client):
    """Test that passwords shorter than 8 characters are rejected (HTTP 422)."""
    response = client.post(
        "/api/auth/register",
        json={"username": "shortpassuser", "password": "abc123"},  # 6 chars
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_register_password_at_min_length_is_accepted(client):
    """Test that a password of exactly 8 characters is accepted."""
    response = client.post(
        "/api/auth/register",
        json={
            "username": "minpassuser",
            "password": "abcd1234",
            "email": "minpass@example.com",
        },  # 8 chars
    )
    assert response.status_code == status.HTTP_201_CREATED


def test_register_password_at_max_length_is_accepted(client):
    """Test that a password of exactly 72 characters (bcrypt limit) is accepted."""
    response = client.post(
        "/api/auth/register",
        json={"username": "maxpassuser", "password": "a" * 72, "email": "maxpass@example.com"},
    )
    assert response.status_code == status.HTTP_201_CREATED


def test_register_password_exceeds_max_length_is_rejected(client):
    """Test that passwords longer than 72 characters are rejected (HTTP 422)."""
    response = client.post(
        "/api/auth/register",
        json={"username": "toolongpassuser", "password": "a" * 73},
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


# ---------------------------------------------------------------------------
# Username normalization tests
# ---------------------------------------------------------------------------


def test_username_is_normalized_on_register(client):
    """Test that usernames are stored lowercased and stripped."""
    response = client.post(
        "/api/auth/register",
        json={
            "username": "  MixedCase  ",
            "password": "testpass123",
            "email": "mixedcase@example.com",
        },
    )
    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()["username"] == "mixedcase"


def test_login_succeeds_with_normalized_username(client):
    """Test that login works when the username was registered with different casing."""
    client.post(
        "/api/auth/register",
        json={"username": "NormUser", "password": "testpass123", "email": "normuser@example.com"},
    )

    response = client.post(
        "/api/auth/login",
        json={"username": "normuser", "password": "testpass123"},
    )
    assert response.status_code == status.HTTP_200_OK
    assert client.cookies["access_token"]


def test_register_duplicate_username_after_normalization_is_rejected(client):
    """Test that registering the same username with different casing is rejected."""
    client.post(
        "/api/auth/register",
        json={"username": "dupuser", "password": "testpass123", "email": "dupuser@example.com"},
    )

    response = client.post(
        "/api/auth/register",
        json={"username": "DUPUSER", "password": "anotherpass", "email": "dupuser2@example.com"},
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


# ---------------------------------------------------------------------------
# Account deletion tests
# ---------------------------------------------------------------------------


def test_delete_account_returns_204(client):
    """Authenticated DELETE /api/auth/me removes the account and returns 204."""
    token = _register_and_login(client, username="deleteuser", password="testpass123")

    response = client.request(
        "DELETE",
        "/api/auth/me",
        json={"current_password": "testpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == status.HTTP_204_NO_CONTENT


def test_delete_account_removes_user_from_db(client):
    """After DELETE /api/auth/me the account is gone — login must return 401."""
    token = _register_and_login(client, username="goneplease", password="testpass123")

    client.request(
        "DELETE",
        "/api/auth/me",
        json={"current_password": "testpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    client.cookies.clear()

    # Old JWT still syntactically valid but user no longer exists — expect 401
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_delete_account_cascades_prompts(client):
    """Deleting an account also removes all prompts owned by that user."""
    token = _register_and_login(client, username="promptowner", password="testpass123")

    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "goal", "content": "some content"}]},
        headers=headers,
    )

    client.request(
        "DELETE", "/api/auth/me", json={"current_password": "testpass123"}, headers=headers
    )
    client.cookies.clear()

    # A new registration should not inherit any prompts
    new_token = _register_and_login(client, username="promptowner", password="newpass99")
    history = client.get(
        "/api/prompts/history",
        headers={"Authorization": f"Bearer {new_token}"},
    )
    assert history.status_code == status.HTTP_200_OK
    assert history.json() == []


def _populate_every_user_owned_table(db, user_id: int) -> None:
    """Insert one row in each table that references the user, directly or via a
    prompt, so a deletion test can assert on the whole graph rather than on the
    two tables that happened to have cascades."""
    from datetime import UTC, datetime

    from app.models.billed_call import BilledCall
    from app.models.eval_case import EvalCase
    from app.models.eval_run import EvalRun
    from app.models.eval_run_result import EvalRunResult
    from app.models.playground_run import PlaygroundRun
    from app.models.prompt import Prompt
    from app.models.prompt_version import PromptVersion

    fields = [{"name": "goal", "content": "x"}]
    prompt = Prompt(user_id=user_id, name="doomed", fields=fields, generated_prompt="x")
    db.add(prompt)
    db.flush()

    db.add(
        PromptVersion(
            prompt_id=prompt.id,
            author_user_id=user_id,
            version_number=1,
            fields=fields,
            generated_prompt="x",
        )
    )
    case = EvalCase(prompt_id=prompt.id, method="rule", criteria="hello")
    db.add(case)
    run = EvalRun(prompt_id=prompt.id, model="gpt-4o-mini", prompt_version_number=1)
    db.add(run)
    db.flush()

    db.add(
        EvalRunResult(
            eval_run_id=run.id, eval_case_id=case.id, method="rule", label="Case 1", score=1.0
        )
    )
    db.add(
        PlaygroundRun(
            prompt_id=prompt.id,
            user_id=user_id,
            model="gpt-4o-mini",
            input_variables={"secret": "value"},
            output_text="model output that must not survive deletion",
        )
    )
    db.add(
        BilledCall(
            user_id=user_id,
            source="playground",
            provider="openai",
            model="gpt-4o-mini",
            cost_usd=0.25,
            created_at=datetime.now(UTC),
        )
    )
    db.commit()


_USER_OWNED_TABLES = (
    "prompts",
    "prompt_versions",
    "eval_cases",
    "eval_runs",
    "eval_run_results",
    "playground_runs",
    "billed_calls",
)


def _row_counts(db) -> dict[str, int]:
    from sqlalchemy import text

    return {
        table: db.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
        for table in _USER_OWNED_TABLES
    }


def test_delete_account_removes_every_user_owned_row(client, test_db):
    """Regression test for the "deletion retains user content and spend records"
    finding: DELETE /api/auth/me promised to remove "all their data" but deleted
    only the users row, leaving Playground inputs/outputs and the billed-call
    ledger behind as orphans."""
    from app.models.user import User

    token = _register_and_login(client, username="fullwipe", password="testpass123")

    db = test_db()
    try:
        user_id = db.query(User).filter(User.username == "fullwipe").one().id
        _populate_every_user_owned_table(db, user_id)
        before = _row_counts(db)
    finally:
        db.close()

    assert all(count == 1 for count in before.values()), before

    response = client.request(
        "DELETE",
        "/api/auth/me",
        json={"current_password": "testpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == status.HTTP_204_NO_CONTENT

    db = test_db()
    try:
        after = _row_counts(db)
        assert db.query(User).count() == 0
    finally:
        db.close()

    assert after == dict.fromkeys(_USER_OWNED_TABLES, 0), after


def test_delete_prompt_removes_its_dependent_rows_but_keeps_billing(client, test_db):
    """Prompt deletion claims to be permanent, so everything hanging off the
    prompt goes with it. Billed calls are keyed to the user, not the prompt, and
    are deliberately retained — deleting a prompt is not a request to rewrite
    the spend ledger."""
    from app.models.prompt import Prompt
    from app.models.user import User

    token = _register_and_login(client, username="promptwipe", password="testpass123")

    db = test_db()
    try:
        user_id = db.query(User).filter(User.username == "promptwipe").one().id
        _populate_every_user_owned_table(db, user_id)
        prompt_id = db.query(Prompt).one().id
    finally:
        db.close()

    response = client.delete(
        f"/api/prompts/{prompt_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == status.HTTP_204_NO_CONTENT

    db = test_db()
    try:
        after = _row_counts(db)
    finally:
        db.close()

    assert after["prompts"] == 0
    assert after["prompt_versions"] == 0
    assert after["eval_cases"] == 0
    assert after["eval_runs"] == 0
    assert after["eval_run_results"] == 0
    assert after["playground_runs"] == 0
    assert after["billed_calls"] == 1


def test_sqlite_foreign_keys_are_enforced(client, test_db):
    """The cascades above are only real if SQLite is actually enforcing foreign
    keys — the PRAGMA is off by default and per-connection, so without it every
    ON DELETE in the schema is inert."""
    from sqlalchemy import text

    db = test_db()
    try:
        assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1
    finally:
        db.close()


def test_delete_account_rejects_a_wrong_password(client):
    """Regression test for "account deletion requires no recent authentication or
    password confirmation". A briefly unattended or stolen authenticated session
    was enough to irreversibly destroy the account and all its data."""
    token = _register_and_login(client, username="needspw", password="testpass123")

    response = client.request(
        "DELETE",
        "/api/auth/me",
        json={"current_password": "not-my-password"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    # And the account is untouched.
    client.cookies.clear()
    assert (
        client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code
        == status.HTTP_200_OK
    )


def test_delete_account_requires_a_password_at_all(client):
    """A session alone must not be accepted — an omitted field is a 422, not a
    silent deletion."""
    token = _register_and_login(client, username="nopwfield", password="testpass123")

    response = client.request(
        "DELETE", "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_delete_account_clears_the_session_cookie(client):
    """The browser should not be left holding a cookie for an account that no
    longer exists."""
    _register_and_login(client, username="cookiewipe", password="testpass123")
    client.post("/api/auth/login", json={"username": "cookiewipe", "password": "testpass123"})

    response = client.request(
        "DELETE",
        "/api/auth/me",
        json={"current_password": "testpass123"},
        headers={CSRF_HEADER_NAME: client.cookies[CSRF_COOKIE_NAME]},
    )

    assert response.status_code == status.HTTP_204_NO_CONTENT
    assert not client.cookies.get("access_token")


def test_delete_account_requires_auth(client):
    """DELETE /api/auth/me without a token returns 403 (missing auth scheme)."""
    response = client.delete("/api/auth/me")
    assert response.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )


def test_delete_account_is_rate_limited(client, monkeypatch):
    """Regression test for Medium (Security): DELETE /api/auth/me previously had
    no rate limit at all. The limiter key is per-client (IP), not per-account, so
    calling it as six distinct freshly-registered users from the same test
    client still shares one bucket and must trip the limit on the sixth call."""
    tokens = [
        _register_and_login(client, username=f"rldelete{i}", password="testpass123")
        for i in range(6)
    ]

    monkeypatch.setenv("TESTING", "false")

    for token in tokens[:5]:
        response = client.request(
            "DELETE",
            "/api/auth/me",
            json={"current_password": "testpass123"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT

    response = client.request(
        "DELETE",
        "/api/auth/me",
        json={"current_password": "testpass123"},
        headers={"Authorization": f"Bearer {tokens[5]}"},
    )
    assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS


# ---------------------------------------------------------------------------
# Profile update (PATCH /api/auth/me) tests
# ---------------------------------------------------------------------------


def test_update_email_sets_email_on_profile(client):
    """PATCH /api/auth/me with a valid email persists the email."""
    token = _register_and_login(client, username="emailuser", password="testpass123")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.patch("/api/auth/me", json={"email": "user@example.com"}, headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["email"] == "user@example.com"


def test_update_email_is_lowercased(client):
    """Emails provided in mixed case are stored in lower case."""
    token = _register_and_login(client, username="caseuser", password="testpass123")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.patch("/api/auth/me", json={"email": "User@EXAMPLE.COM"}, headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["email"] == "user@example.com"


def test_update_email_rejects_invalid_address(client):
    """Profile email must be syntactically valid."""
    token = _register_and_login(client, username="invalidemail", password="testpass123")

    resp = client.patch(
        "/api/auth/me",
        json={"email": "not-an-email"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_update_email_conflict_returns_409(client):
    """Setting an email already used by another account returns 409."""
    t1 = _register_and_login(client, username="user_a", password="testpass123")
    t2 = _register_and_login(client, username="user_b", password="testpass123")

    client.patch(
        "/api/auth/me",
        json={"email": "shared@example.com"},
        headers={"Authorization": f"Bearer {t1}"},
    )
    resp = client.patch(
        "/api/auth/me",
        json={"email": "shared@example.com"},
        headers={"Authorization": f"Bearer {t2}"},
    )
    assert resp.status_code == status.HTTP_409_CONFLICT


def test_update_profile_is_rate_limited(client, monkeypatch):
    """Regression test for Medium (Security): PATCH /api/auth/me had no rate
    limit, and its 409-on-conflict response otherwise lets an unthrottled
    caller enumerate registered emails/usernames."""
    token = _register_and_login(client, username="rlpatch", password="testpass123")
    headers = {"Authorization": f"Bearer {token}"}
    monkeypatch.setenv("TESTING", "false")

    for _ in range(10):
        response = client.patch("/api/auth/me", json={"notify_run_failure": True}, headers=headers)
        assert response.status_code == status.HTTP_200_OK

    response = client.patch("/api/auth/me", json={"notify_run_failure": True}, headers=headers)
    assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS


# ---------------------------------------------------------------------------
# Forgot-password / reset-password tests
# ---------------------------------------------------------------------------


def test_forgot_password_always_returns_200(client):
    """POST /api/auth/forgot-password always returns 200 regardless of whether email exists."""
    resp = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert resp.status_code == status.HTTP_200_OK
    assert "reset link" in resp.json()["message"].lower()


def test_reset_password_with_valid_token_succeeds(client, db_session):
    """A valid unexpired token allows the password to be changed."""
    from datetime import timedelta
    import secrets

    token = _register_and_login(client, username="resetme", password="oldpass99")
    headers = {"Authorization": f"Bearer {token}"}
    client.patch("/api/auth/me", json={"email": "resetme@example.com"}, headers=headers)

    # Directly inject a reset token into the DB (bypasses email sending)
    from datetime import UTC, datetime

    from app.models.user import User as UserModel

    user = db_session.query(UserModel).filter(UserModel.username == "resetme").first()
    reset_tok = secrets.token_hex(32)
    from app.auth.utils import hash_password_reset_token

    user.reset_token = hash_password_reset_token(reset_tok)
    user.reset_token_expiry = datetime.now(UTC) + timedelta(hours=1)
    db_session.commit()

    resp = client.post(
        "/api/auth/reset-password",
        json={"token": reset_tok, "new_password": "NewPass99!"},
    )
    assert resp.status_code == status.HTTP_200_OK

    # Old password should no longer work
    assert (
        client.post(
            "/api/auth/login", json={"username": "resetme", "password": "oldpass99"}
        ).status_code
        == status.HTTP_401_UNAUTHORIZED
    )

    # New password should work
    assert (
        client.post(
            "/api/auth/login", json={"username": "resetme", "password": "NewPass99!"}
        ).status_code
        == status.HTTP_200_OK
    )


def test_reset_password_with_invalid_token_returns_400(client):
    """An unknown token returns 400."""
    resp = client.post(
        "/api/auth/reset-password",
        json={"token": "nosuchtoken", "new_password": "NewPass99!"},
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_reset_password_with_expired_token_returns_400(client, db_session):
    """An expired token returns 400 and is cleared from the DB."""
    from datetime import UTC, datetime, timedelta
    import secrets

    _register_and_login(client, username="expireset", password="testpass123")

    from app.models.user import User as UserModel

    user = db_session.query(UserModel).filter(UserModel.username == "expireset").first()
    reset_tok = secrets.token_hex(32)
    from app.auth.utils import hash_password_reset_token

    user.reset_token = hash_password_reset_token(reset_tok)
    user.reset_token_expiry = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()

    resp = client.post(
        "/api/auth/reset-password",
        json={"token": reset_tok, "new_password": "NewPass99!"},
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST

    # Token must be cleared after expiry attempt
    db_session.refresh(user)
    assert user.reset_token is None


def test_reset_token_is_single_use(client, db_session):
    """After a successful reset the token cannot be reused."""
    from datetime import UTC, datetime, timedelta
    import secrets

    _register_and_login(client, username="singleuse", password="testpass123")

    from app.models.user import User as UserModel

    user = db_session.query(UserModel).filter(UserModel.username == "singleuse").first()
    reset_tok = secrets.token_hex(32)
    from app.auth.utils import hash_password_reset_token

    user.reset_token = hash_password_reset_token(reset_tok)
    user.reset_token_expiry = datetime.now(UTC) + timedelta(hours=1)
    db_session.commit()

    client.post(
        "/api/auth/reset-password",
        json={"token": reset_tok, "new_password": "NewPass99!"},
    )

    # Second attempt with the same token must fail
    resp = client.post(
        "/api/auth/reset-password",
        json={"token": reset_tok, "new_password": "AnotherPass99!"},
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


# ---------------------------------------------------------------------------
# Username change tests (Feature 5)
# ---------------------------------------------------------------------------


def test_change_username_returns_updated_profile(client):
    """PATCH /api/auth/me with new_username updates the stored username."""
    token = _register_and_login(client, username="origname", password="testpass123")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.patch("/api/auth/me", json={"new_username": "newname"}, headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["username"] == "newname"


def test_change_username_is_lowercased(client):
    """New usernames are normalized to lowercase."""
    token = _register_and_login(client, username="casechange", password="testpass123")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.patch("/api/auth/me", json={"new_username": "CaseChange2"}, headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["username"] == "casechange2"


def test_change_username_conflict_returns_409(client):
    """Changing to a username already taken by another account returns 409."""
    token_a = _register_and_login(client, username="user_alpha", password="testpass123")
    _register_and_login(client, username="user_beta", password="testpass123")

    resp = client.patch(
        "/api/auth/me",
        json={"new_username": "user_beta"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert resp.status_code == 409


def test_change_username_invalid_pattern_returns_422(client):
    """Usernames with spaces or special characters are rejected with 422."""
    token = _register_and_login(client, username="patternuser", password="testpass123")

    resp = client.patch(
        "/api/auth/me",
        json={"new_username": "bad user!"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


def test_change_username_too_short_returns_422(client):
    """Usernames shorter than 3 characters are rejected with 422."""
    token = _register_and_login(client, username="shortcheck", password="testpass123")

    resp = client.patch(
        "/api/auth/me",
        json={"new_username": "ab"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Authenticated password change
# ---------------------------------------------------------------------------


def test_change_password_success(client):
    """A correct current_password lets the user set a new password."""
    token = _register_and_login(client, username="pwchange", password="oldpass123")

    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "oldpass123", "new_password": "newpass456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == status.HTTP_200_OK

    old_login = client.post(
        "/api/auth/login", json={"username": "pwchange", "password": "oldpass123"}
    )
    assert old_login.status_code == status.HTTP_401_UNAUTHORIZED

    new_login = client.post(
        "/api/auth/login", json={"username": "pwchange", "password": "newpass456"}
    )
    assert new_login.status_code == status.HTTP_200_OK


def test_change_password_wrong_current_password(client):
    """An incorrect current_password is rejected with 401 and the password is unchanged."""
    token = _register_and_login(client, username="pwwrong", password="correctpass")

    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "wrongpass", "new_password": "newpass456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    login = client.post("/api/auth/login", json={"username": "pwwrong", "password": "correctpass"})
    assert login.status_code == status.HTTP_200_OK


def test_change_password_requires_authentication(client):
    """The endpoint rejects requests without a bearer token."""
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "a", "new_password": "newpass456"},
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_change_password_rejects_short_new_password(client):
    """new_password shorter than 8 characters is rejected with 422."""
    token = _register_and_login(client, username="pwshort", password="oldpass123")

    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "oldpass123", "new_password": "abc123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_change_password_revokes_tokens_issued_before_it(client):
    """Regression test for "password reset and change do not revoke existing
    sessions". This previously asserted the opposite — that the pre-change token
    kept working — which codified the exposure: changing a password is how a user
    evicts an attacker holding a stolen session, and a copied JWT stayed usable
    until it expired on its own."""
    token = _register_and_login(client, username="pwtoken", password="oldpass123")

    changed = client.post(
        "/api/auth/change-password",
        json={"current_password": "oldpass123", "new_password": "newpass456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert changed.status_code == status.HTTP_200_OK

    # The response re-issues a session cookie for the caller, and cookie auth
    # takes precedence over a bearer header — so the jar has to be emptied for
    # this to actually test the old token.
    client.cookies.clear()

    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_change_password_keeps_the_calling_session_signed_in(client):
    """The tab doing the change gets a token on the new version, so revoking
    every other session does not sign the user out of the one they are using."""
    _register_and_login(client, username="pwkeep", password="oldpass123")
    client.post("/api/auth/login", json={"username": "pwkeep", "password": "oldpass123"})

    changed = client.post(
        "/api/auth/change-password",
        json={"current_password": "oldpass123", "new_password": "newpass456"},
        headers={CSRF_HEADER_NAME: client.cookies[CSRF_COOKIE_NAME]},
    )
    assert changed.status_code == status.HTTP_200_OK

    assert client.get("/api/auth/me").status_code == status.HTTP_200_OK


def test_password_reset_revokes_tokens_issued_before_it(client, monkeypatch):
    """Account recovery has to recover the account: a session stolen before the
    reset must stop working, not survive until its own expiry."""
    from app.api import auth_routes

    token = _register_and_login(client, username="resetrevoke", password="oldpass123")
    captured: dict[str, str] = {}

    def fake_send(*, to_email, reset_link):
        captured["url"] = reset_link

    monkeypatch.setattr(auth_routes, "send_password_reset_email", fake_send)
    client.post("/api/auth/forgot-password", json={"email": "resetrevoke@example.com"})

    raw_token = captured["url"].rsplit("=", 1)[-1]
    reset = client.post(
        "/api/auth/reset-password",
        json={"token": raw_token, "new_password": "brandnewpass789"},
    )
    assert reset.status_code == status.HTTP_200_OK

    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_logout_all_invalidates_every_session(client):
    """ "Sign out everywhere" must reach sessions this request knows nothing
    about, which a cookie-clearing logout cannot do."""
    first = _register_and_login(client, username="logoutall", password="testpass123")
    client.post("/api/auth/login", json={"username": "logoutall", "password": "testpass123"})
    second = client.cookies["access_token"]
    client.cookies.clear()

    assert (
        client.post(
            "/api/auth/logout-all", headers={"Authorization": f"Bearer {second}"}
        ).status_code
        == status.HTTP_204_NO_CONTENT
    )

    for token in (first, second):
        resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_logout_all_requires_authentication(client):
    assert client.post("/api/auth/logout-all").status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )


# ---------------------------------------------------------------------------
# SECRET_KEY startup guard
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    [
        "your-secret-key-change-this-in-production",
        "your-secret-key-change-this-in-production-use-openssl-rand-hex-32",
        "CHANGE_ME_RUN_openssl_rand_hex_32",
        "  CHANGE_ME_RUN_openssl_rand_hex_32  ",
    ],
)
def test_published_example_keys_are_rejected(key):
    """Every signing key this repo has ever shipped must fail closed.

    Regression coverage for the pre-publication defect where the startup guard
    compared against a single constant, so the *other* published placeholder in
    `.env.example` was accepted and could be used to forge JWTs.
    """
    assert is_insecure_secret_key(key) is True


@pytest.mark.parametrize("key", ["", "short", "a" * 31])
def test_short_keys_are_rejected(key):
    """A key too short to resist offline brute force is rejected regardless of origin."""
    assert is_insecure_secret_key(key) is True


def test_generated_key_is_accepted():
    """A key of the shape `openssl rand -hex 32` produces is accepted."""
    assert is_insecure_secret_key(secrets.token_hex(32)) is False


def test_startup_guard_raises_on_insecure_key(monkeypatch):
    """The main-module guard refuses to start the app with a published key."""
    monkeypatch.setattr(main, "SECRET_KEY", "CHANGE_ME_RUN_openssl_rand_hex_32")
    monkeypatch.delenv("TESTING", raising=False)

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        main.enforce_secret_key_policy()


def test_startup_guard_passes_on_strong_key(monkeypatch):
    """A strong key passes the guard without raising."""
    monkeypatch.setattr(main, "SECRET_KEY", secrets.token_hex(32))
    monkeypatch.delenv("TESTING", raising=False)

    main.enforce_secret_key_policy()


# ---------------------------------------------------------------------------
# Registration mode
# ---------------------------------------------------------------------------


def test_registration_closed_allows_only_the_first_account(client, monkeypatch):
    """Regression test for the open-registration SSRF finding: an account is
    what unlocks server-side requests to a user-supplied provider URL, so a
    public deployment must not hand one to every visitor. A fresh install still
    has to be usable, hence the first-account bootstrap."""
    monkeypatch.setenv("REGISTRATION_MODE", "closed")

    first = client.post(
        "/api/auth/register",
        json={"username": "operator", "password": "testpass123", "email": "op@example.com"},
    )
    assert first.status_code == status.HTTP_201_CREATED

    second = client.post(
        "/api/auth/register",
        json={"username": "stranger", "password": "testpass123", "email": "x@example.com"},
    )
    assert second.status_code == status.HTTP_403_FORBIDDEN
    assert "closed" in second.json()["detail"].lower()


def test_registration_defaults_to_closed(client, monkeypatch):
    """An unset REGISTRATION_MODE must not mean open. Anything unrecognised is
    treated as closed too, so a typo fails safe."""
    monkeypatch.delenv("REGISTRATION_MODE", raising=False)
    client.post(
        "/api/auth/register",
        json={"username": "operator", "password": "testpass123", "email": "op@example.com"},
    )
    blocked = client.post(
        "/api/auth/register",
        json={"username": "stranger", "password": "testpass123", "email": "x@example.com"},
    )
    assert blocked.status_code == status.HTTP_403_FORBIDDEN

    monkeypatch.setenv("REGISTRATION_MODE", "Open")  # case-insensitive
    assert (
        client.post(
            "/api/auth/register",
            json={"username": "invited", "password": "testpass123", "email": "i@example.com"},
        ).status_code
        == status.HTTP_201_CREATED
    )


def test_registration_open_allows_many_accounts(client, monkeypatch):
    monkeypatch.setenv("REGISTRATION_MODE", "open")
    for name in ("one", "two"):
        response = client.post(
            "/api/auth/register",
            json={
                "username": name,
                "password": "testpass123",
                "email": f"{name}@example.com",
            },
        )
        assert response.status_code == status.HTTP_201_CREATED
