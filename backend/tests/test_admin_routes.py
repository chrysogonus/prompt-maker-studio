"""
Tests for operator diagnostics routes.
"""

from unittest.mock import patch


class TestSmtpDiagnostics:
    """Tests for POST /api/admin/smtp/check."""

    @patch.dict("os.environ", {}, clear=True)
    def test_smtp_check_requires_admin_token_configuration(self, client):
        response = client.post("/api/admin/smtp/check")

        assert response.status_code == 503
        assert response.json()["detail"] == "Admin diagnostics are not configured."

    @patch.dict("os.environ", {"ADMIN_DIAGNOSTICS_TOKEN": "secret"}, clear=False)
    def test_smtp_check_rejects_invalid_token(self, client):
        response = client.post("/api/admin/smtp/check", headers={"X-Admin-Token": "wrong"})

        assert response.status_code == 403

    @patch.dict("os.environ", {"ADMIN_DIAGNOSTICS_TOKEN": "secret"}, clear=False)
    def test_smtp_check_rejects_missing_token_header(self, client):
        """A missing header must not crash hmac.compare_digest (which requires
        two strings, not None) — regression test for the != -> compare_digest fix."""
        response = client.post("/api/admin/smtp/check")

        assert response.status_code == 403

    @patch.dict("os.environ", {"ADMIN_DIAGNOSTICS_TOKEN": "secret"}, clear=False)
    def test_smtp_check_rejects_wrong_length_token(self, client):
        """hmac.compare_digest handles mismatched-length inputs without raising."""
        response = client.post(
            "/api/admin/smtp/check", headers={"X-Admin-Token": "much-longer-than-secret"}
        )

        assert response.status_code == 403

    @patch.dict("os.environ", {"ADMIN_DIAGNOSTICS_TOKEN": "secret"}, clear=False)
    @patch("app.api.admin_routes.check_smtp_connection")
    def test_smtp_check_runs_smoke_test(self, mock_check, client):
        response = client.post("/api/admin/smtp/check", headers={"X-Admin-Token": "secret"})

        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "message": "SMTP connectivity check succeeded.",
        }
        mock_check.assert_called_once()

    @patch.dict("os.environ", {"ADMIN_DIAGNOSTICS_TOKEN": "secret"}, clear=False)
    @patch("app.api.admin_routes.check_smtp_connection")
    def test_smtp_check_failure_does_not_leak_exception_details(self, mock_check, client):
        """Regression test for the information-disclosure finding: the raw
        exception string (host/port/internal error text) must not appear in
        the HTTP response body, only in the server log."""
        mock_check.side_effect = OSError("connection refused to smtp.internal.example:587")
        response = client.post("/api/admin/smtp/check", headers={"X-Admin-Token": "secret"})

        assert response.status_code == 503
        assert "smtp.internal.example" not in response.text
        assert (
            response.json()["detail"]
            == "SMTP connectivity check failed. See server logs for details."
        )
