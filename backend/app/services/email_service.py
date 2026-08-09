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
import html
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


def send_playground_run_failure_email(to_email: str, prompt_name: str, error_message: str) -> None:
    """
    Notify a user that their Playground run failed, for users who opted in
    via the `notify_run_failure` Settings preference.

    Args:
        to_email:      Recipient email address.
        prompt_name:   Name of the prompt that was being tested.
        error_message: The failure reason surfaced to the user.

    Raises:
        RuntimeError: If required SMTP env vars are missing.
        smtplib.SMTPException: If the SMTP server rejects the message.
    """
    smtp_host = _get_required_env("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = _get_required_env("SMTP_FROM")

    subject = f'Playground run failed for "{prompt_name}"'

    text_body = (
        f'Your Playground run for "{prompt_name}" failed to complete.\n\n'
        f"Error: {error_message}\n\n"
        f"You can turn off these emails in Settings → Notifications.\n"
    )

    escaped_prompt_name = html.escape(prompt_name)
    escaped_error_message = html.escape(error_message)

    html_body = f"""\
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem; color: #1a1a1a;">
  <h2 style="margin-bottom: 0.5rem;">Playground run failed</h2>
  <p>Your run for <strong>{escaped_prompt_name}</strong> did not complete successfully.</p>
  <p style="color:#6b7280; font-size:0.875rem;">{escaped_error_message}</p>
  <p style="color:#6b7280; font-size:0.875rem;">
    You can turn off these emails in Settings &rarr; Notifications.
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
        "Sending Playground run-failure email to %s via %s:%s",
        redact_email(to_email),
        smtp_host,
        smtp_port,
    )

    _send_message(msg, to_email)

    logger.info("Playground run-failure email delivered to %s", redact_email(to_email))


def send_weekly_summary_email(to_email: str, summary: dict) -> None:
    """
    Send a weekly usage-summary email to a user opted into
    `notify_weekly_summary`, called by `backend/scripts/send_weekly_summary_email.py`
    on a cron-invoked schedule (see `make send-weekly-summary`).

    Args:
        to_email: Recipient email address.
        summary:  Digest dict from `AnalyticsService.weekly_digest` — keys
                  `total_runs_7d`, `success_rate_pct_7d`, `top_prompts_7d`.

    Raises:
        RuntimeError: If required SMTP env vars are missing.
        smtplib.SMTPException: If the SMTP server rejects the message.
    """
    smtp_host = _get_required_env("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = _get_required_env("SMTP_FROM")

    total_runs = summary["total_runs_7d"]
    success_rate_pct = summary["success_rate_pct_7d"]
    top_prompts = summary["top_prompts_7d"]

    subject = f"Your weekly {APP_NAME} summary"

    success_rate_text = f"{success_rate_pct}%" if success_rate_pct is not None else "N/A"
    top_prompts_text = (
        "\n".join(f"  - {p['name']}: {p['run_count']} runs" for p in top_prompts)
        if top_prompts
        else "  (no Playground runs this week)"
    )

    text_body = (
        f"Here's your {APP_NAME} usage summary for the past 7 days:\n\n"
        f"Playground runs: {total_runs}\n"
        f"Success rate: {success_rate_text}\n\n"
        f"Top prompts:\n{top_prompts_text}\n\n"
        f"You can turn off these emails in Settings → Notifications.\n"
    )

    top_prompts_html = (
        "".join(f"<li>{html.escape(p['name'])}: {p['run_count']} runs</li>" for p in top_prompts)
        if top_prompts
        else "<li>No Playground runs this week</li>"
    )

    html_body = f"""\
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem; color: #1a1a1a;">
  <h2 style="margin-bottom: 0.5rem;">Your weekly summary</h2>
  <p>Here's your <strong>{APP_NAME}</strong> usage for the past 7 days.</p>
  <p>
    Playground runs: <strong>{total_runs}</strong><br>
    Success rate: <strong>{success_rate_text}</strong>
  </p>
  <p><strong>Top prompts:</strong></p>
  <ul>{top_prompts_html}</ul>
  <p style="color:#6b7280; font-size:0.875rem;">
    You can turn off these emails in Settings &rarr; Notifications.
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
        "Sending weekly summary email to %s via %s:%s", redact_email(to_email), smtp_host, smtp_port
    )

    _send_message(msg, to_email)

    logger.info("Weekly summary email delivered to %s", redact_email(to_email))


def send_eval_run_complete_email(to_email: str, prompt_name: str, score: float) -> None:
    """
    Notify a user that an eval run finished scoring, for users who opted in
    via the `notify_eval_complete` Settings preference.

    Args:
        to_email:    Recipient email address.
        prompt_name: Name of the prompt that was evaluated.
        score:       The run's aggregate score (0-100).

    Raises:
        RuntimeError: If required SMTP env vars are missing.
        smtplib.SMTPException: If the SMTP server rejects the message.
    """
    smtp_host = _get_required_env("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = _get_required_env("SMTP_FROM")

    subject = f'Evaluation complete for "{prompt_name}"'

    text_body = (
        f'Your evaluation run for "{prompt_name}" finished scoring.\n\n'
        f"Score: {score:.0f}\n\n"
        f"You can turn off these emails in Settings → Notifications.\n"
    )

    escaped_prompt_name = html.escape(prompt_name)

    html_body = f"""\
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem; color: #1a1a1a;">
  <h2 style="margin-bottom: 0.5rem;">Evaluation complete</h2>
  <p>Your evaluation run for <strong>{escaped_prompt_name}</strong> finished scoring.</p>
  <p>Score: <strong>{score:.0f}</strong></p>
  <p style="color:#6b7280; font-size:0.875rem;">
    You can turn off these emails in Settings &rarr; Notifications.
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
        "Sending eval-run-complete email to %s via %s:%s",
        redact_email(to_email),
        smtp_host,
        smtp_port,
    )

    _send_message(msg, to_email)

    logger.info("Eval-run-complete email delivered to %s", redact_email(to_email))


def send_eval_score_regression_email(
    to_email: str, prompt_name: str, previous_score: float, new_score: float
) -> None:
    """
    Notify a user that an eval run scored lower than the previous run, for
    users who opted in via the `notify_eval_regression` Settings preference.

    Args:
        to_email:       Recipient email address.
        prompt_name:    Name of the prompt that was evaluated.
        previous_score: The immediately-preceding run's aggregate score.
        new_score:      The new run's aggregate score, lower than previous_score.

    Raises:
        RuntimeError: If required SMTP env vars are missing.
        smtplib.SMTPException: If the SMTP server rejects the message.
    """
    smtp_host = _get_required_env("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = _get_required_env("SMTP_FROM")

    subject = f'Evaluation score dropped for "{prompt_name}"'

    text_body = (
        f'Your evaluation score for "{prompt_name}" dropped from '
        f"{previous_score:.0f} to {new_score:.0f}.\n\n"
        f"You can turn off these emails in Settings → Notifications.\n"
    )

    escaped_prompt_name = html.escape(prompt_name)

    html_body = f"""\
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem; color: #1a1a1a;">
  <h2 style="margin-bottom: 0.5rem;">Evaluation score dropped</h2>
  <p>
    Your evaluation score for <strong>{escaped_prompt_name}</strong> dropped from
    <strong>{previous_score:.0f}</strong> to <strong>{new_score:.0f}</strong>.
  </p>
  <p style="color:#6b7280; font-size:0.875rem;">
    You can turn off these emails in Settings &rarr; Notifications.
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
        "Sending eval-score-regression email to %s via %s:%s",
        redact_email(to_email),
        smtp_host,
        smtp_port,
    )

    _send_message(msg, to_email)

    logger.info("Eval-score-regression email delivered to %s", redact_email(to_email))
