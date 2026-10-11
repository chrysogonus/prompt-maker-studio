"""Historical SQLite migration v010_playground_runs."""

from __future__ import annotations

from sqlalchemy import text


def _migration_010_playground_runs(connection) -> None:
    """Create the playground_runs table for Playground execution history."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS playground_runs ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "prompt_id INTEGER NOT NULL REFERENCES prompts(id), "
            "user_id INTEGER NOT NULL REFERENCES users(id), "
            "model VARCHAR(100) NOT NULL, "
            "input_variables JSON, "
            "output_text TEXT NOT NULL DEFAULT '', "
            "latency_ms INTEGER NOT NULL DEFAULT 0, "
            "prompt_tokens INTEGER NOT NULL DEFAULT 0, "
            "completion_tokens INTEGER NOT NULL DEFAULT 0, "
            "cost_usd REAL NOT NULL DEFAULT 0, "
            "status VARCHAR(20) NOT NULL DEFAULT 'success', "
            "error_message TEXT, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_playground_runs_prompt_id ON playground_runs (prompt_id)"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_playground_runs_user_id ON playground_runs (user_id)")
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_playground_runs_created_at "
            "ON playground_runs (created_at)"
        )
    )
