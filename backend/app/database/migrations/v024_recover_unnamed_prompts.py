"""Historical SQLite migration v024_recover_unnamed_prompts."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import text

from app.database.migrations.helpers import _table_exists

RECOVERED_HISTORY_FOLDER = "Recovered history"


def _recovered_prompt_name(created_at: str | None) -> str:
    """`Untitled (14 Mar 2026, 09:12 UTC)` — timestamps are stored as naive UTC."""
    if not created_at:
        return "Untitled"
    moment = datetime.fromisoformat(str(created_at))
    return f"Untitled ({moment.day} {moment:%b %Y, %H:%M} UTC)"


def _migration_024_recover_unnamed_prompts(connection) -> None:
    """Move unnamed prompts out of the retired History log into the library.

    Every Generate click used to store an unnamed prompt that only the History
    tab listed. That tab is going away, so each one gets a readable date-based
    name and lands in the "Recovered history" folder, unless it was already
    filed somewhere. Nothing is deduplicated: identical fields can still differ
    in text that was edited by hand.
    """
    if not _table_exists(connection, "prompts"):
        return

    rows = connection.execute(
        text('SELECT id, created_at FROM "prompts" WHERE name IS NULL')
    ).mappings()
    for row in rows.all():
        connection.execute(
            text(
                'UPDATE "prompts" SET name = :name, folder = COALESCE(folder, :folder) '
                "WHERE id = :prompt_id"
            ),
            {
                "name": _recovered_prompt_name(row["created_at"]),
                "folder": RECOVERED_HISTORY_FOLDER,
                "prompt_id": row["id"],
            },
        )
