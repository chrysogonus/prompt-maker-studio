"""Historical SQLite migration v013_user_eval_and_library_preferences."""

from __future__ import annotations

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_013_user_eval_and_library_preferences(connection) -> None:
    """Add Settings preference columns for the Library default view and Evaluate feature."""
    if not _table_exists(connection, "users"):
        return

    _add_column_if_missing(connection, "users", "default_library_view", "VARCHAR(10)")
    _add_column_if_missing(connection, "users", "default_eval_method", "VARCHAR(20)")
    _add_column_if_missing(
        connection, "users", "auto_run_eval_on_update", "BOOLEAN NOT NULL DEFAULT 0"
    )
    _add_column_if_missing(
        connection, "users", "notify_eval_complete", "BOOLEAN NOT NULL DEFAULT 0"
    )
    _add_column_if_missing(
        connection, "users", "notify_eval_regression", "BOOLEAN NOT NULL DEFAULT 0"
    )
