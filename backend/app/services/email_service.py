"""
Email sending service for transactional emails (e.g. password reset).

Uses the Python standard library smtplib — no additional runtime dependency.
All configuration is read from environment variables at call time so that tests
can override them without restarting the process.

Required env vars (all optional; if absent the service raises a clear error):
  SMTP_HOST     — SMTP server hostname (e.g. smtp.mailgun.org)
  SMTP_PORT     — SMTP port (default: 587)
  SMTP_USER     — SMTP login username
  SMTP_PASSWORD — SMTP login password
  SMTP_FROM     — Sender address, e.g. "Prompt Maker Studio <no-reply@yourdomain.com>"
"""

from collections.abc import Iterator
from contextlib import contextmanager
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import logging
import os
import smtplib
import ssl

from app.branding import APP_NAME

logger = logging.getLogger(__name__)


def redact_email(email: str) -> str:
    """Mask an email's local-part for logging, e.g. "j***@example.com".

    Full addresses are real users' PII; logging them in plaintext at INFO
    level puts them, unredacted, into Docker stdout / any future log
    aggregation with no defined retention policy.
    """
    local, sep, domain = email.partition("@")
    if not sep:
        return "***"
    masked_local = f"{local[0]}***" if local else "***"
    return f"{masked_local}@{domain}"


def _get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        msg = (
            f"SMTP configuration error: environment variable {name!r} is not set. "
            "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM "
            "to enable transactional email."
        )
        raise RuntimeError(msg)
    return value


@contextmanager
def _smtp_session() -> Iterator[smtplib.SMTP]:
    """Yield an authenticated SMTP connection over verified TLS.

    Every mail path goes through here so there is exactly one place TLS can be
    got wrong. `ssl.create_default_context()` verifies the chain and the
    hostname and fails closed; omitting it — which is what passing nothing to
    `starttls()` does — silently accepts an impersonated server.
    """
    smtp_host = _get_required_env("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = _get_required_env("SMTP_USER")
    smtp_password = _get_required_env("SMTP_PASSWORD")
    tls_mode = os.getenv("SMTP_TLS_MODE", "starttls").strip().lower()
    context = ssl.create_default_context()

    if tls_mode == "implicit":
        server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10, context=context)
    elif tls_mode == "starttls":
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
    else:
        msg = (
            f"SMTP configuration error: SMTP_TLS_MODE={tls_mode!r} is not recognised. "
            'Use "starttls" (default) or "implicit".'
        )
        raise RuntimeError(msg)

    # Operate on the context-manager target rather than `server`: smtplib
    # returns self, but going through __enter__ is the documented contract.
    with server as connection:
        if tls_mode == "starttls":
            connection.ehlo()
            connection.starttls(context=context)
        connection.login(smtp_user, smtp_password)
        yield connection


def _send_message(msg: MIMEMultipart, to_email: str) -> None:
    """Deliver one already-built message."""
    smtp_from = _get_required_env("SMTP_FROM")
    with _smtp_session() as server:
        server.sendmail(smtp_from, to_email, msg.as_string())


def check_smtp_connection() -> None:
    """Validate SMTP configuration and perform a TLS/login smoke check."""
    smtp_host = _get_required_env("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    _get_required_env("SMTP_FROM")

    logger.info("Checking SMTP connectivity to %s:%s", smtp_host, smtp_port)
    with _smtp_session():
        pass
    logger.info("SMTP connectivity check succeeded for %s:%s", smtp_host, smtp_port)


def send_password_reset_email(to_email: str, reset_link: str) -> None:
    """
    Send a password-reset email to the given address.

    Args:
        to_email:   Recipient email address.
        reset_link: The full URL the user must visit to complete the reset,
                    e.g. https://yourdomain.com/reset-password?token=<token>

    Raises:
        RuntimeError: If required SMTP env vars are missing.
        smtplib.SMTPException: If the SMTP server rejects the message.
    """
    smtp_host = _get_required_env("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = _get_required_env("SMTP_FROM")

    subject = f"Reset your {APP_NAME} password"

    text_body = (
        f"You requested a password reset for your {APP_NAME} account.\n\n"
        f"Click the link below to set a new password (valid for 1 hour):\n\n"
        f"{reset_link}\n\n"
        f"If you did not request this, you can safely ignore this email.\n"
    )

    html_body = f"""\
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem; color: #1a1a1a;">
  <h2 style="margin-bottom: 0.5rem;">Reset your password</h2>
  <p>You requested a password reset for your <strong>{APP_NAME}</strong> account.</p>
  <p>
    <a href="{reset_link}"
       style="display:inline-block; padding: 0.625rem 1.25rem; background:#2563eb;
              color:white; border-radius:6px; text-decoration:none; font-weight:600;">
      Reset password
    </a>
  </p>
  <p style="color:#6b7280; font-size:0.875rem;">
    This link expires in <strong>1 hour</strong>.<br>
    If you did not request this, you can safely ignore this email.
  </p>
</body>
</html>
"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    logger.info(
        "Sending password reset email to %s via %s:%s", redact_email(to_email), smtp_host, smtp_port
    )

    _send_message(msg, to_email)

    logger.info("Password reset email delivered to %s", redact_email(to_email))


def send_email_changed_notification(to_email: str, new_email: str) -> None:
    """
    Tell the previous address that the account's email was changed.

    The new address is redacted: the old mailbox may no longer belong to the
    account holder, and it only needs to know a change happened.

    Raises:
        RuntimeError: If required SMTP env vars are missing.
        smtplib.SMTPException: If the SMTP server rejects the message.
    """
    msg = MIMEMultipart()
    msg["Subject"] = f"Your {APP_NAME} email address was changed"
    msg["From"] = _get_required_env("SMTP_FROM")
    msg["To"] = to_email
    msg.attach(
        MIMEText(
            f"The email address on your {APP_NAME} account was changed to "
            f"{redact_email(new_email)}.\n\n"
            # Not "reset your password": the reset link would now go to the new address.
            "If you did not make this change, sign in and change your password "
            "immediately, then contact the site operator.\n",
            "plain",
        )
    )
    _send_message(msg, to_email)
    logger.info("Email-change notice delivered to %s", redact_email(to_email))
