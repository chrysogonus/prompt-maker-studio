"""
Send the weekly usage-summary email to every user who opted in via the
Settings "Weekly summary" toggle (`users.notify_weekly_summary`).

Intended to run on a weekly schedule against the running backend container:

    make send-weekly-summary

(wraps `docker compose exec backend python -m scripts.send_weekly_summary_email`)
— see docs/deployment.md for the recommended host crontab entry. This script
needs the full `app` package (models, DB session, email service), unlike the
dependency-free root-level `scripts/backup_sqlite.py`/`restore_sqlite.py`.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.database.connection import SessionLocal
from app.models.user import User
from app.services.analytics_service import AnalyticsService
from app.services.email_service import send_weekly_summary_email

logger = logging.getLogger(__name__)


def send_all_weekly_summaries(db: Session) -> int:
    """
    Send a weekly digest to every opted-in user with an email on file.

    A failure sending to one user is logged and does not stop the batch.

    Returns:
        Number of emails successfully sent.
    """
    users = (
        db.query(User).filter(User.notify_weekly_summary.is_(True), User.email.isnot(None)).all()
    )

    sent = 0
    for user in users:
        try:
            digest = AnalyticsService.weekly_digest(db, user.id)
            send_weekly_summary_email(user.email, digest)
            sent += 1
        except Exception:
            logger.exception("Failed to send weekly summary email to user_id=%s", user.id)
            continue

    return sent


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    db = SessionLocal()
    try:
        sent = send_all_weekly_summaries(db)
        logger.info("Weekly summary batch complete: %d email(s) sent", sent)
    finally:
        db.close()


if __name__ == "__main__":
    main()
