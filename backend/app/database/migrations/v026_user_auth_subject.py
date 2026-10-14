"""Historical SQLite migration v026_user_auth_subject."""

from uuid import uuid4

from sqlalchemy import text

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_026_user_auth_subject(connection) -> None:
    """Assign an immutable random token subject to every existing account."""
    if not _table_exists(connection, "users"):
        return
    _add_column_if_missing(connection, "users", "auth_subject", "VARCHAR(36)")
    user_ids = (
        connection.execute(text("SELECT id FROM users WHERE auth_subject IS NULL")).scalars().all()
    )
    for user_id in user_ids:
        connection.execute(
            text("UPDATE users SET auth_subject = :subject WHERE id = :user_id"),
            {"subject": str(uuid4()), "user_id": user_id},
        )
    connection.execute(
        text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_auth_subject ON users (auth_subject)")
    )
