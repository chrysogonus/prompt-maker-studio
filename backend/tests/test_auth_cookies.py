"""
Tests for cookie-based sessions and their CSRF protection.

The rest of the suite drives the API with bearer tokens (see `conftest.py` for
why). These tests exercise the path a real browser takes: an httpOnly session
cookie the page cannot read, plus a readable CSRF token it must echo back.
"""

from fastapi import status

from app.auth.cookies import CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME


def _register_and_login(client, username="cookieuser", password="testpass123"):
    """Log in and leave the resulting cookies in the client's jar."""
    client.post(
        "/api/auth/register",
        json={"username": username, "password": password, "email": f"{username}@example.com"},
    )
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )


def _csrf_header(client):
    return {CSRF_HEADER_NAME: client.cookies[CSRF_COOKIE_NAME]}


class TestSessionCookies:
    def test_login_sets_an_httponly_session_cookie(self, client):
        response = _register_and_login(client)

        assert response.status_code == status.HTTP_200_OK
        set_cookies = response.headers.get_list("set-cookie")
        session_cookie = next(c for c in set_cookies if c.startswith(f"{SESSION_COOKIE_NAME}="))
        assert "HttpOnly" in session_cookie
        assert "SameSite=lax" in session_cookie.lower().replace("samesite=lax", "SameSite=lax")

    def test_login_does_not_return_the_token_in_the_body(self, client):
        """The whole point: no script on the page can ever read the token."""
        response = _register_and_login(client)

        body = response.json()
        assert "access_token" not in body
        assert body["expires_at"]

    def test_csrf_cookie_is_readable_by_the_page(self, client):
        """Unlike the session cookie — the frontend has to echo this one back."""
        response = _register_and_login(client)

        csrf_cookie = next(
            c for c in response.headers.get_list("set-cookie") if c.startswith(CSRF_COOKIE_NAME)
        )
        assert "HttpOnly" not in csrf_cookie

    def test_cookie_authenticates_a_read(self, client):
        _register_and_login(client)

        response = client.get("/api/auth/me")

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["username"] == "cookieuser"

    def test_logout_clears_both_cookies(self, client):
        _register_and_login(client)

        response = client.post("/api/auth/logout")

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert client.cookies.get(SESSION_COOKIE_NAME) in (None, "")
        assert client.cookies.get(CSRF_COOKIE_NAME) in (None, "")
        assert client.get("/api/auth/me").status_code == status.HTTP_401_UNAUTHORIZED

    def test_logout_succeeds_without_a_session(self, client):
        """Signing out must work even after the token has already expired."""
        assert client.post("/api/auth/logout").status_code == status.HTTP_204_NO_CONTENT

    def test_refresh_reissues_both_cookies(self, client):
        _register_and_login(client)
        original_csrf = client.cookies[CSRF_COOKIE_NAME]

        response = client.post("/api/auth/refresh", headers=_csrf_header(client))

        assert response.status_code == status.HTTP_200_OK
        # The JWT can come back byte-identical when the refresh lands in the
        # same second as the login (`iat`/`exp` have one-second resolution), so
        # the observable rotation is the CSRF token, which is random per issue.
        assert client.cookies[CSRF_COOKIE_NAME] != original_csrf
        assert client.get("/api/auth/me").status_code == status.HTTP_200_OK
        # And the refreshed CSRF token is the one now accepted.
        assert (
            client.patch(
                "/api/auth/me",
                json={"notify_run_failure": True},
                headers=_csrf_header(client),
            ).status_code
            == status.HTTP_200_OK
        )


class TestCsrfProtection:
    def test_write_succeeds_with_a_matching_csrf_token(self, client):
        _register_and_login(client)

        response = client.patch(
            "/api/auth/me",
            json={"notify_run_failure": True},
            headers=_csrf_header(client),
        )

        assert response.status_code == status.HTTP_200_OK

    def test_write_without_the_csrf_header_is_rejected(self, client):
        """The shape of a cross-site forgery: cookie present, header absent."""
        _register_and_login(client)

        response = client.patch("/api/auth/me", json={"notify_run_failure": True})

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "CSRF" in response.json()["detail"]

    def test_write_with_a_mismatched_csrf_token_is_rejected(self, client):
        _register_and_login(client)

        response = client.patch(
            "/api/auth/me",
            json={"notify_run_failure": True},
            headers={CSRF_HEADER_NAME: "not-the-real-token"},
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_reads_need_no_csrf_token(self, client):
        _register_and_login(client)

        assert client.get("/api/auth/me").status_code == status.HTTP_200_OK

    def test_bearer_writes_need_no_csrf_token(self, client):
        """A browser never attaches Authorization on its own, so it cannot be forged."""
        _register_and_login(client)
        token = client.cookies[SESSION_COOKIE_NAME]
        client.cookies.clear()

        response = client.patch(
            "/api/auth/me",
            json={"notify_run_failure": True},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == status.HTTP_200_OK

    def test_csrf_cookie_alone_does_not_authenticate(self, client):
        """The readable half is not a credential — only proof of same-site origin."""
        _register_and_login(client)
        csrf = client.cookies[CSRF_COOKIE_NAME]
        client.cookies.clear()
        client.cookies.set(CSRF_COOKIE_NAME, csrf)

        response = client.get("/api/auth/me")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED


class TestCookieConfiguration:
    """The two settings a deployment has to get right (see docs/deployment.md)."""

    def test_domain_is_applied_when_configured(self, client, monkeypatch):
        """Production scopes one cookie to the parent of the app and API hosts."""
        monkeypatch.setenv("COOKIE_DOMAIN", ".example.com")

        response = _register_and_login(client, username="domainuser")

        session_cookie = next(
            c
            for c in response.headers.get_list("set-cookie")
            if c.startswith(f"{SESSION_COOKIE_NAME}=")
        )
        assert "domain=.example.com" in session_cookie.lower()

    def test_secure_flag_is_set_by_default(self, client, monkeypatch):
        """Absent configuration must fail closed, not ship cookies in the clear."""
        monkeypatch.delenv("COOKIE_SECURE", raising=False)

        response = _register_and_login(client, username="secureuser")

        session_cookie = next(
            c
            for c in response.headers.get_list("set-cookie")
            if c.startswith(f"{SESSION_COOKIE_NAME}=")
        )
        assert "Secure" in session_cookie

    def test_logout_clears_with_the_configured_domain(self, client, monkeypatch):
        """Clearing must repeat the set attributes or the browser keeps the cookie."""
        monkeypatch.setenv("COOKIE_DOMAIN", ".example.com")

        response = client.post("/api/auth/logout")

        assert all(
            "domain=.example.com" in c.lower() for c in response.headers.get_list("set-cookie")
        )
