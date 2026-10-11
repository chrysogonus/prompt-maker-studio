"""Application-level Prometheus metrics."""

from prometheus_client import Counter

password_reset_email_failures_total = Counter(
    "password_reset_email_failures_total",
    "Number of password-reset email delivery failures.",
)

prompts_saved_total = Counter(
    "prompts_saved_total",
    "Number of prompts saved to a library, from the web app or an MCP client.",
)

ai_imports_total = Counter(
    "ai_imports_total",
    "Number of AI text-import attempts via POST /api/prompts/parse-text.",
)

ai_import_failures_total = Counter(
    "ai_import_failures_total",
    "Number of AI text-import attempts that failed.",
)

user_registrations_total = Counter(
    "user_registrations_total",
    "Number of successful user registrations.",
)

login_successes_total = Counter(
    "login_successes_total",
    "Number of successful logins.",
)
