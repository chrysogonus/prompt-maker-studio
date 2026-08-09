"""Tests for backend/scripts/send_weekly_summary_email.py's batch logic."""

from unittest.mock import patch

from scripts.send_weekly_summary_email import send_all_weekly_summaries


def _register(client, username, email):
    client.post(
        "/api/auth/register",
        json={"username": username, "password": "testpass123", "email": email},
    )
    client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    token = client.cookies["access_token"]
    client.cookies.clear()
    return {"Authorization": f"Bearer {token}"}


class TestSendAllWeeklySummaries:
    def test_only_sends_to_opted_in_users_with_email(self, client, db_session):
        opted_in = _register(client, "opted_in", "opted-in@example.com")
        _register(client, "opted_out", "opted-out@example.com")

        client.patch("/api/auth/me", headers=opted_in, json={"notify_weekly_summary": True})
        # opted_out never sets notify_weekly_summary=True — stays default False

        with patch("scripts.send_weekly_summary_email.send_weekly_summary_email") as mock_send:
            sent = send_all_weekly_summaries(db_session)

        assert sent == 1
        mock_send.assert_called_once()
        assert mock_send.call_args[0][0] == "opted-in@example.com"

    def test_per_user_failure_does_not_abort_the_batch(self, client, db_session):
        first = _register(client, "first", "first@example.com")
        _register(client, "second", "second@example.com")
        client.patch("/api/auth/me", headers=first, json={"notify_weekly_summary": True})

        second_headers = _register(client, "third", "third@example.com")
        client.patch("/api/auth/me", headers=second_headers, json={"notify_weekly_summary": True})

        with patch(
            "scripts.send_weekly_summary_email.send_weekly_summary_email",
            side_effect=[RuntimeError("SMTP down"), None],
        ) as mock_send:
            sent = send_all_weekly_summaries(db_session)

        assert mock_send.call_count == 2
        assert sent == 1

    def test_no_opted_in_users_sends_nothing(self, db_session):
        assert send_all_weekly_summaries(db_session) == 0
