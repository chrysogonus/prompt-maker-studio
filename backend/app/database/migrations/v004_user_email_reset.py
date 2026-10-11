"""Historical SQLite migration v004_user_email_reset."""

from __future__ import annotations

from sqlalchemy import text

from app.database.migrations.helpers import _add_column_if_missing, _indexes, _table_exists


def _migration_004_user_email_reset(connection) -> None:
    """Add profile email and password-reset columns to users."""
    if not _table_exists(connection, "users"):
        return

    _add_column_if_missing(connection, "users", "email", "VARCHAR(255)")
    _add_column_if_missing(connection, "users", "reset_token", "VARCHAR(255)")
    _add_column_if_missing(connection, "users", "reset_token_expiry", "DATETIME")

    indexes = _indexes(connection, "users")
    if "ix_users_email" not in indexes:
        connection.execute(
            text('CREATE UNIQUE INDEX ix_users_email ON "users" (email) WHERE email IS NOT NULL')
        )
    if "ix_users_reset_token" not in indexes:
        connection.execute(
            text(
                'CREATE INDEX ix_users_reset_token ON "users" (reset_token) '
                "WHERE reset_token IS NOT NULL"
            )
        )
