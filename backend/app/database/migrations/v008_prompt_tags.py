"""Historical SQLite migration v008_prompt_tags."""

from __future__ import annotations

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_008_prompt_tags(connection) -> None:
    """Add the tags list column to prompts."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "tags", "JSON")
