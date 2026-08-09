"""
Unit tests for the email service.

All SMTP I/O is mocked so no real network calls are made.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

from app.services.email_service import (
    check_smtp_connection,
    redact_email,
    send_eval_run_complete_email,
    send_eval_score_regression_email,
    send_password_reset_email,
    send_playground_run_failure_email,
    send_weekly_summary_email,
)


class TestRedactEmail:
    """Regression tests for Medium (Data Handling): full recipient email
    addresses were logged in plaintext at INFO level on every send/failure."""

    def test_masks_local_part_keeps_domain(self):
        assert redact_email("jane.doe@example.com") == "j***@example.com"

    def test_single_character_local_part(self):
        assert redact_email("j@example.com") == "j***@example.com"

    def test_non_email_input_fully_redacted(self):
        assert redact_email("not-an-email") == "***"


class TestSendPasswordResetEmail:
    """Tests for send_password_reset_email."""

    _SMTP_ENV = {
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "user@example.com",
        "SMTP_PASSWORD": "secret",
        "SMTP_FROM": "Prompt Maker Studio <no-reply@example.com>",
    }

    def _patch_env(self):
        return patch.dict(os.environ, self._SMTP_ENV, clear=False)

    def test_sends_email_successfully(self):
        """Happy path — sends without raising when SMTP succeeds."""
        mock_server = MagicMock()
        with self._patch_env(), patch("smtplib.SMTP", return_value=mock_server) as mock_smtp_cls:
            mock_smtp_cls.return_value.__enter__ = lambda _: mock_server
            mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)

            send_password_reset_email(
                to_email="recipient@example.com",
                reset_link="https://example.com/reset-password?token=abc123",
            )

            mock_server.ehlo.assert_called_once()
            mock_server.starttls.assert_called_once()
            mock_server.login.assert_called_once_with("user@example.com", "secret")
            mock_server.sendmail.assert_called_once()
            # Verify recipient and sender are correct in the sendmail call
            _from, _to, _msg = mock_server.sendmail.call_args[0]
            assert _to == "recipient@example.com"

    def test_logs_do_not_contain_the_full_email_address(self, caplog):
        """The full address must never appear in emitted log records — only
        the redacted form (e.g. "r***@example.com")."""
        mock_server = MagicMock()
        with (
            self._patch_env(),
            patch("smtplib.SMTP", return_value=mock_server) as mock_smtp_cls,
            caplog.at_level("INFO"),
        ):
            mock_smtp_cls.return_value.__enter__ = lambda _: mock_server
            mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)

            send_password_reset_email(
                to_email="recipient@example.com",
                reset_link="https://example.com/reset-password?token=abc123",
            )

        assert "recipient@example.com" not in caplog.text
        assert "r***@example.com" in caplog.text

    def test_raises_when_smtp_host_missing(self):
        """RuntimeError is raised when SMTP_HOST env var is absent."""
        env_without_host = {k: v for k, v in self._SMTP_ENV.items() if k != "SMTP_HOST"}
        with patch.dict(os.environ, env_without_host, clear=False):
            os.environ.pop("SMTP_HOST", None)
            with pytest.raises(RuntimeError, match="SMTP_HOST"):
                send_password_reset_email(
                    to_email="r@example.com",
                    reset_link="https://example.com/reset?token=x",
                )

    def test_raises_when_smtp_password_missing(self):
        """RuntimeError is raised when SMTP_PASSWORD env var is absent."""
        env_without_pass = {k: v for k, v in self._SMTP_ENV.items() if k != "SMTP_PASSWORD"}
        with patch.dict(os.environ, env_without_pass, clear=False):
            os.environ.pop("SMTP_PASSWORD", None)
            with pytest.raises(RuntimeError, match="SMTP_PASSWORD"):
                send_password_reset_email(
                    to_email="r@example.com",
                    reset_link="https://example.com/reset?token=x",
                )

    def test_smtp_exception_propagates(self):
        """An SMTP error raised by the server propagates to the caller."""
        import smtplib

        mock_server = MagicMock()
        mock_server.sendmail.side_effect = smtplib.SMTPException("delivery failed")

        with self._patch_env(), patch("smtplib.SMTP", return_value=mock_server):
            mock_server.__enter__ = lambda _: mock_server
            mock_server.__exit__ = MagicMock(return_value=False)

            with pytest.raises(smtplib.SMTPException):
                send_password_reset_email(
                    to_email="r@example.com",
                    reset_link="https://example.com/reset?token=x",
                )

    def test_default_smtp_port_is_587(self):
        """When SMTP_PORT is not set the default 587 is used."""
        env_no_port = {k: v for k, v in self._SMTP_ENV.items() if k != "SMTP_PORT"}
        mock_server = MagicMock()
        with patch.dict(os.environ, env_no_port, clear=False):
            os.environ.pop("SMTP_PORT", None)
            with patch("smtplib.SMTP", return_value=mock_server) as mock_smtp_cls:
                mock_smtp_cls.return_value.__enter__ = lambda _: mock_server
                mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)

                send_password_reset_email(
                    to_email="r@example.com",
                    reset_link="https://example.com/reset?token=x",
                )

                _, call_kwargs = mock_smtp_cls.call_args
                positional = mock_smtp_cls.call_args[0]
                assert positional[1] == 587


class TestSendPlaygroundRunFailureEmail:
    """Tests for send_playground_run_failure_email."""

    _SMTP_ENV = {
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "user@example.com",
        "SMTP_PASSWORD": "secret",
        "SMTP_FROM": "Prompt Maker Studio <no-reply@example.com>",
    }

    def _patch_env(self):
        return patch.dict(os.environ, self._SMTP_ENV, clear=False)

    def test_sends_email_successfully(self):
        mock_server = MagicMock()
        with self._patch_env(), patch("smtplib.SMTP", return_value=mock_server) as mock_smtp_cls:
            mock_smtp_cls.return_value.__enter__ = lambda _: mock_server
            mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)

            send_playground_run_failure_email(
                to_email="recipient@example.com",
                prompt_name="Support Triage",
                error_message="OpenAI request timed out",
            )

            mock_server.ehlo.assert_called_once()
            mock_server.starttls.assert_called_once()
            mock_server.login.assert_called_once_with("user@example.com", "secret")
            mock_server.sendmail.assert_called_once()
            _from, _to, msg = mock_server.sendmail.call_args[0]
            assert _to == "recipient@example.com"
            assert "Support Triage" in msg

    def test_raises_when_smtp_host_missing(self):
        env_without_host = {k: v for k, v in self._SMTP_ENV.items() if k != "SMTP_HOST"}
        with patch.dict(os.environ, env_without_host, clear=False):
            os.environ.pop("SMTP_HOST", None)
            with pytest.raises(RuntimeError, match="SMTP_HOST"):
                send_playground_run_failure_email(
                    to_email="r@example.com", prompt_name="P", error_message="boom"
                )

    def test_smtp_exception_propagates(self):
        import smtplib

        mock_server = MagicMock()
        mock_server.sendmail.side_effect = smtplib.SMTPException("delivery failed")

        with self._patch_env(), patch("smtplib.SMTP", return_value=mock_server):
            mock_server.__enter__ = lambda _: mock_server
            mock_server.__exit__ = MagicMock(return_value=False)

            with pytest.raises(smtplib.SMTPException):
                send_playground_run_failure_email(
                    to_email="r@example.com", prompt_name="P", error_message="boom"
                )


class TestSendWeeklySummaryEmail:
    """Tests for send_weekly_summary_email."""

    _SMTP_ENV = {
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "user@example.com",
        "SMTP_PASSWORD": "secret",
        "SMTP_FROM": "Prompt Maker Studio <no-reply@example.com>",
    }

    _SUMMARY = {
        "total_runs_7d": 4,
        "success_rate_pct_7d": 75.0,
        "top_prompts_7d": [{"prompt_id": 1, "name": "Support Triage", "run_count": 3}],
    }

    def _patch_env(self):
        return patch.dict(os.environ, self._SMTP_ENV, clear=False)

    def test_sends_email_successfully(self):
        mock_server = MagicMock()
        with self._patch_env(), patch("smtplib.SMTP", return_value=mock_server) as mock_smtp_cls:
            mock_smtp_cls.return_value.__enter__ = lambda _: mock_server
            mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)

            send_weekly_summary_email(to_email="recipient@example.com", summary=self._SUMMARY)

            mock_server.ehlo.assert_called_once()
            mock_server.starttls.assert_called_once()
            mock_server.login.assert_called_once_with("user@example.com", "secret")
            mock_server.sendmail.assert_called_once()
            _from, _to, msg = mock_server.sendmail.call_args[0]
            assert _to == "recipient@example.com"
            assert "Support Triage" in msg

    def test_handles_empty_top_prompts(self):
        mock_server = MagicMock()
        empty_summary = {"total_runs_7d": 0, "success_rate_pct_7d": None, "top_prompts_7d": []}
        with self._patch_env(), patch("smtplib.SMTP", return_value=mock_server) as mock_smtp_cls:
            mock_smtp_cls.return_value.__enter__ = lambda _: mock_server
            mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)

            send_weekly_summary_email(to_email="recipient@example.com", summary=empty_summary)

            mock_server.sendmail.assert_called_once()

    def test_raises_when_smtp_host_missing(self):
        env_without_host = {k: v for k, v in self._SMTP_ENV.items() if k != "SMTP_HOST"}
        with patch.dict(os.environ, env_without_host, clear=False):
            os.environ.pop("SMTP_HOST", None)
            with pytest.raises(RuntimeError, match="SMTP_HOST"):
                send_weekly_summary_email(to_email="r@example.com", summary=self._SUMMARY)

    def test_smtp_exception_propagates(self):
        import smtplib

        mock_server = MagicMock()
        mock_server.sendmail.side_effect = smtplib.SMTPException("delivery failed")

        with self._patch_env(), patch("smtplib.SMTP", return_value=mock_server):
            mock_server.__enter__ = lambda _: mock_server
            mock_server.__exit__ = MagicMock(return_value=False)

            with pytest.raises(smtplib.SMTPException):
                send_weekly_summary_email(to_email="r@example.com", summary=self._SUMMARY)


class TestSendEvalRunCompleteEmail:
    """Tests for send_eval_run_complete_email."""

    _SMTP_ENV = {
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "user@example.com",
        "SMTP_PASSWORD": "secret",
        "SMTP_FROM": "Prompt Maker Studio <no-reply@example.com>",
    }

    def _patch_env(self):
        return patch.dict(os.environ, self._SMTP_ENV, clear=False)

    def test_sends_email_successfully(self):
        mock_server = MagicMock()
        with self._patch_env(), patch("smtplib.SMTP", return_value=mock_server) as mock_smtp_cls:
            mock_smtp_cls.return_value.__enter__ = lambda _: mock_server
            mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)

            send_eval_run_complete_email(
                to_email="recipient@example.com", prompt_name="Support Triage", score=87.5
            )

            mock_server.sendmail.assert_called_once()
            _from, _to, msg = mock_server.sendmail.call_args[0]
            assert _to == "recipient@example.com"
            assert "Support Triage" in msg

    def test_raises_when_smtp_host_missing(self):
        env_without_host = {k: v for k, v in self._SMTP_ENV.items() if k != "SMTP_HOST"}
        with patch.dict(os.environ, env_without_host, clear=False):
            os.environ.pop("SMTP_HOST", None)
            with pytest.raises(RuntimeError, match="SMTP_HOST"):
                send_eval_run_complete_email(to_email="r@example.com", prompt_name="P", score=50.0)


class TestSendEvalScoreRegressionEmail:
    """Tests for send_eval_score_regression_email."""

    _SMTP_ENV = {
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "user@example.com",
        "SMTP_PASSWORD": "secret",
        "SMTP_FROM": "Prompt Maker Studio <no-reply@example.com>",
    }

    def _patch_env(self):
        return patch.dict(os.environ, self._SMTP_ENV, clear=False)

    def test_sends_email_successfully(self):
        mock_server = MagicMock()
        with self._patch_env(), patch("smtplib.SMTP", return_value=mock_server) as mock_smtp_cls:
            mock_smtp_cls.return_value.__enter__ = lambda _: mock_server
            mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)

            send_eval_score_regression_email(
                to_email="recipient@example.com",
                prompt_name="Support Triage",
                previous_score=90.0,
                new_score=60.0,
            )

            mock_server.sendmail.assert_called_once()
            _from, _to, msg = mock_server.sendmail.call_args[0]
            assert _to == "recipient@example.com"
            assert "Support Triage" in msg

    def test_raises_when_smtp_host_missing(self):
        env_without_host = {k: v for k, v in self._SMTP_ENV.items() if k != "SMTP_HOST"}
        with patch.dict(os.environ, env_without_host, clear=False):
            os.environ.pop("SMTP_HOST", None)
            with pytest.raises(RuntimeError, match="SMTP_HOST"):
                send_eval_score_regression_email(
                    to_email="r@example.com", prompt_name="P", previous_score=90.0, new_score=60.0
                )


class TestCheckSmtpConnection:
    """Tests for SMTP smoke checks."""

    @patch.dict(
        os.environ,
        {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "587",
            "SMTP_USER": "user",
            "SMTP_PASSWORD": "pass",
            "SMTP_FROM": "Prompt Maker Studio <no-reply@example.com>",
        },
    )
    @patch("app.services.email_service.smtplib.SMTP")
    def test_checks_smtp_connection_successfully(self, mock_smtp):
        mock_server = mock_smtp.return_value.__enter__.return_value

        check_smtp_connection()

        mock_smtp.assert_called_once_with("smtp.example.com", 587, timeout=10)
        mock_server.starttls.assert_called_once()
        mock_server.login.assert_called_once_with("user", "pass")

    @patch.dict(os.environ, {}, clear=True)
    def test_raises_when_required_smtp_config_missing(self):
        with pytest.raises(RuntimeError, match="SMTP_HOST"):
            check_smtp_connection()


class TestSmtpTlsVerification:
    """Regression tests for "SMTP credentials and reset mail are sent over TLS
    without certificate verification".

    Every path called `starttls()` with no SSL context. The context smtplib
    builds in that case is non-verifying — check_hostname=False and
    verify_mode=CERT_NONE — so an impersonated SMTP server was accepted, along
    with the credentials and password-reset links handed to it.
    """

    _ENV = {
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "user",
        "SMTP_PASSWORD": "pass",
        "SMTP_FROM": "Prompt Maker Studio <no-reply@example.com>",
    }

    def test_the_stdlib_default_this_guards_against_is_really_non_verifying(self):
        """Pins the premise, so this suite still means something if CPython's
        implicit context ever changes."""
        import ssl

        context = ssl._create_stdlib_context()
        assert context.check_hostname is False
        assert context.verify_mode == ssl.CERT_NONE

    @patch.dict(os.environ, _ENV)
    @patch("app.services.email_service.smtplib.SMTP")
    def test_starttls_is_given_a_verifying_context(self, mock_smtp):
        import ssl

        send_password_reset_email(to_email="user@example.com", reset_link="https://x/y")

        server = mock_smtp.return_value.__enter__.return_value
        server.starttls.assert_called_once()
        context = server.starttls.call_args.kwargs["context"]
        assert isinstance(context, ssl.SSLContext)
        assert context.check_hostname is True
        assert context.verify_mode == ssl.CERT_REQUIRED

    @patch.dict(os.environ, {**_ENV, "SMTP_PORT": "465", "SMTP_TLS_MODE": "implicit"})
    @patch("app.services.email_service.smtplib.SMTP_SSL")
    def test_implicit_tls_mode_verifies_too(self, mock_smtp_ssl):
        import ssl

        send_password_reset_email(to_email="user@example.com", reset_link="https://x/y")

        mock_smtp_ssl.assert_called_once()
        context = mock_smtp_ssl.call_args.kwargs["context"]
        assert context.check_hostname is True
        assert context.verify_mode == ssl.CERT_REQUIRED
        # Implicit TLS is already encrypted; upgrading again would be an error.
        mock_smtp_ssl.return_value.__enter__.return_value.starttls.assert_not_called()

    @patch.dict(os.environ, {**_ENV, "SMTP_TLS_MODE": "none"})
    def test_an_unrecognised_tls_mode_fails_closed(self):
        """Rather than quietly falling back to an unencrypted connection."""
        with pytest.raises(RuntimeError, match="SMTP_TLS_MODE"):
            send_password_reset_email(to_email="user@example.com", reset_link="https://x/y")

    @patch.dict(os.environ, _ENV)
    @patch("app.services.email_service.smtplib.SMTP")
    def test_a_tls_failure_is_not_swallowed(self, mock_smtp):
        """A verification error has to propagate: sending the mail anyway over a
        connection that failed to verify is worse than not sending it."""
        import ssl

        server = mock_smtp.return_value.__enter__.return_value
        server.starttls.side_effect = ssl.SSLCertVerificationError("bad cert")

        with pytest.raises(ssl.SSLCertVerificationError):
            send_password_reset_email(to_email="user@example.com", reset_link="https://x/y")

        server.sendmail.assert_not_called()
