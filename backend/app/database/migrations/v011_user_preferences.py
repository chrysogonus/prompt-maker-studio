"""Historical SQLite migration v011_user_preferences."""

from __future__ import annotations

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_011_user_preferences(connection) -> None:
    """Add Settings preference columns to users."""
    if not _table_exists(connection, "users"):
        return

    _add_column_if_missing(connection, "users", "default_model", "VARCHAR(100)")
    _add_column_if_missing(connection, "users", "notify_run_failure", "BOOLEAN NOT NULL DEFAULT 0")
    _add_column_if_missing(
        connection, "users", "notify_weekly_summary", "BOOLEAN NOT NULL DEFAULT 0"
    )
