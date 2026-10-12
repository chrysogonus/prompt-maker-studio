"""Historical SQLite migration v003_prompt_name."""

from __future__ import annotations

from sqlalchemy import text

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_003_prompt_name(connection) -> None:
    """Add prompt name column used for server-side saved prompts."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "name", "VARCHAR(255)")
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_prompts_name ON "prompts" (name)'))
