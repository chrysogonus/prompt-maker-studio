"""Historical SQLite migration v018_prompt_id_sequence."""

from __future__ import annotations

from sqlalchemy import text


def _migration_018_prompt_id_sequence(connection) -> None:
    """Persist a prompt-ID high-water mark so SQLite never recycles IDs."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS prompt_id_sequence ("
            "singleton INTEGER PRIMARY KEY CHECK (singleton = 1), "
            "last_id INTEGER NOT NULL DEFAULT 0"
            ")"
        )
    )
    connection.execute(
        text(
            "INSERT OR IGNORE INTO prompt_id_sequence (singleton, last_id) "
            "SELECT 1, COALESCE(MAX(id), 0) FROM prompts"
        )
    )
    connection.execute(
        text(
            "UPDATE prompt_id_sequence "
            "SET last_id = MAX(last_id, COALESCE((SELECT MAX(id) FROM prompts), 0)) "
            "WHERE singleton = 1"
        )
    )
