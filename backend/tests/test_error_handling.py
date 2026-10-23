"""
Tests for app-wide error handling: the request-id correlation middleware and
the catch-all handler for exceptions not already mapped to an HTTPException.
"""

import logging
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.database.connection import get_db
from app.main import app


class TestRequestIdMiddleware:
    def test_every_response_carries_a_request_id_header(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert response.headers.get("X-Request-ID")

    def test_request_ids_are_unique_per_request(self, client):
        first = client.get("/").headers["X-Request-ID"]
        second = client.get("/").headers["X-Request-ID"]
        assert first != second


class TestUnhandledExceptionHandler:
    """Regression tests for Low (Error Handling): unhandled exceptions
    previously fell through to Starlette's bare default 500 with no
    request-id/correlation token to help support real user bug reports."""

    def test_unhandled_exception_returns_generic_500_with_request_id(self, test_db, auth_headers):
        # TestClient's default raise_server_exceptions=True re-raises the
        # underlying exception to the caller after the handler runs, purely
        # as a test-debugging aid (see Starlette's ServerErrorMiddleware) — a
        # real ASGI deployment always just returns the response over the
        # wire. Disabling it here exercises the actual production behavior.
        def override_get_db():
            session = test_db()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_get_db
        try:
            with (
                TestClient(app, raise_server_exceptions=False) as no_raise_client,
                patch(
                    "app.services.prompts.library.render_sections",
                    side_effect=RuntimeError("sensitive internal detail: db-password=hunter2"),
                ),
            ):
                response = no_raise_client.post(
                    "/api/prompts",
                    headers=auth_headers,
                    json={"name": "Boom", "fields": [{"name": "goal", "content": "x"}]},
                )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 500
        body = response.json()
        assert body["detail"] == "An unexpected error occurred. Please try again."
        assert "request_id" in body
        assert "sensitive internal detail" not in response.text
        assert "hunter2" not in response.text
        assert response.headers["X-Request-ID"] == body["request_id"]


class TestValidationExceptionHandler:
    def test_rejected_password_is_not_logged_or_returned(self, client, caplog):
        rejected_password = "S3cr3t!"

        with caplog.at_level(logging.WARNING, logger="app.main"):
            response = client.post(
                "/api/auth/register",
                json={
                    "username": "validuser",
                    "password": rejected_password,
                    "email": "validuser@example.com",
                },
            )

        assert response.status_code == 422
        assert rejected_password not in caplog.text
        assert rejected_password not in response.text
        assert "string_too_short" in caplog.text

    def test_reserved_email_domain_gets_a_plain_message(self, client):
        response = client.post(
            "/api/auth/register",
            json={"username": "qa_user", "password": "long-enough-1!", "email": "qa@example.test"},
        )

        assert response.status_code == 422
        assert response.json()["detail"][0]["msg"] == (
            "Enter an email address you can receive mail at."
        )
        assert "@-sign" not in response.text

    def test_validator_messages_drop_the_value_error_prefix(self, client):
        response = client.post(
            "/api/auth/register",
            json={"username": "qa_user", "password": "no-digits-here!", "email": "qa@gmail.com"},
        )

        assert response.status_code == 422
        assert response.json()["detail"][0]["msg"] == "Password must contain at least one number"
