"""Historical SQLite migration v009_prompt_versions."""

from __future__ import annotations

from sqlalchemy import text


def _migration_009_prompt_versions(connection) -> None:
    """Create the prompt_versions table for prompt version history."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS prompt_versions ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "prompt_id INTEGER NOT NULL REFERENCES prompts(id), "
            "version_number INTEGER NOT NULL, "
            "note VARCHAR(255), "
            "author_user_id INTEGER REFERENCES users(id), "
            "fields JSON NOT NULL, "
            "generated_prompt TEXT NOT NULL, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_prompt_versions_prompt_id ON prompt_versions (prompt_id)"
        )
    )
