"""Historical SQLite migration v016_billed_calls."""

from __future__ import annotations

from sqlalchemy import text


def _migration_016_billed_calls(connection) -> None:
    """Create the billed_calls table — the unified AI spend ledger written by
    every OpenAI call path so budget ceilings count eval/judge/refine/parse
    spend, not just Playground runs. Existing playground_runs rows are NOT
    backfilled: ledger history starts at deploy time, so month-to-date budget
    visibility resets once (in the user's favor) rather than risking
    double-counting with a permanent UNION over two tables."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS billed_calls ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "user_id INTEGER NOT NULL REFERENCES users(id), "
            "source VARCHAR(30) NOT NULL, "
            "model VARCHAR(100) NOT NULL, "
            "prompt_tokens INTEGER NOT NULL DEFAULT 0, "
            "completion_tokens INTEGER NOT NULL DEFAULT 0, "
            "cost_usd REAL NOT NULL DEFAULT 0, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_billed_calls_user_id ON billed_calls (user_id)")
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_billed_calls_source ON billed_calls (source)")
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_billed_calls_created_at ON billed_calls (created_at)")
    )
