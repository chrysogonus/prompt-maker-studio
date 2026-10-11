"""Historical SQLite migration v005_prompt_updated_at."""

from __future__ import annotations

from sqlalchemy import text

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_005_prompt_updated_at(connection) -> None:
    """Add updated_at column to prompts; backfill with created_at for existing rows."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "updated_at", "DATETIME")
    connection.execute(
        text('UPDATE "prompts" SET updated_at = created_at WHERE updated_at IS NULL')
    )
