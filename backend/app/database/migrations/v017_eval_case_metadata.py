"""Historical SQLite migration v017_eval_case_metadata."""

from __future__ import annotations

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_017_eval_case_metadata(connection) -> None:
    """Add user-facing case names and an explicit intentionally-empty flag."""
    if not _table_exists(connection, "eval_cases"):
        return

    _add_column_if_missing(connection, "eval_cases", "name", "VARCHAR(100)")
    _add_column_if_missing(
        connection,
        "eval_cases",
        "intentionally_empty",
        "BOOLEAN NOT NULL DEFAULT 0",
    )
