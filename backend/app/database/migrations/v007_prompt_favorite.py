"""Historical SQLite migration v007_prompt_favorite."""

from __future__ import annotations

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_007_prompt_favorite(connection) -> None:
    """Add the favorite flag column to prompts, defaulting existing rows to false."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "is_favorite", "BOOLEAN NOT NULL DEFAULT 0")
