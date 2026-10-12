"""Historical SQLite migration v006_prompt_folder."""

from __future__ import annotations

from sqlalchemy import text

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_006_prompt_folder(connection) -> None:
    """Add the free-text folder label column to prompts, and index it."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "folder", "VARCHAR(255)")
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_prompts_folder ON "prompts" (folder)'))
