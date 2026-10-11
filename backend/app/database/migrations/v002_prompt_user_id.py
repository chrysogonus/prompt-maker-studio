"""Historical SQLite migration v002_prompt_user_id."""

from __future__ import annotations

from sqlalchemy import text

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_002_prompt_user_id(connection) -> None:
    """Add prompt ownership column and backfill ownerless rows when possible."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(
        connection, "prompts", "user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE"
    )

    if _table_exists(connection, "users"):
        oldest_user = connection.execute(
            text('SELECT id FROM "users" ORDER BY created_at ASC LIMIT 1')
        ).first()
        if oldest_user is not None:
            connection.execute(
                text('UPDATE "prompts" SET user_id = :user_id WHERE user_id IS NULL'),
                {"user_id": oldest_user[0]},
            )

    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_prompts_user_id ON "prompts" (user_id)'))
