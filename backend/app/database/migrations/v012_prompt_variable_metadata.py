"""Historical SQLite migration v012_prompt_variable_metadata."""

from __future__ import annotations

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_012_prompt_variable_metadata(connection) -> None:
    """Add the variable_metadata JSON column to prompts (type + description per variable)."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "variable_metadata", "JSON")
