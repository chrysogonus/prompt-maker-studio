"""Allocate prompt IDs monotonically on SQLite.

PostgreSQL already uses a non-recycling sequence. SQLite's default INTEGER
PRIMARY KEY may reuse the highest deleted ID, so it needs an explicit durable
high-water mark to keep old deep links from resolving to unrelated prompts.
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

# Import registers the allocator table with Base.metadata for fresh test DBs.
from app.models.prompt_id_sequence import PromptIdSequence  # noqa: F401


class PromptIdService:
    """Allocate a new prompt ID when the database dialect needs it."""

    @staticmethod
    def next_id(db: Session) -> int | None:
        if db.bind is None or db.bind.dialect.name != "sqlite":
            return None

        db.execute(
            text(
                "INSERT OR IGNORE INTO prompt_id_sequence (singleton, last_id) "
                "SELECT 1, COALESCE(MAX(id), 0) FROM prompts"
            )
        )
        db.execute(
            text(
                "UPDATE prompt_id_sequence "
                "SET last_id = MAX(last_id, COALESCE((SELECT MAX(id) FROM prompts), 0)) + 1 "
                "WHERE singleton = 1"
            )
        )
        allocated = db.execute(
            text("SELECT last_id FROM prompt_id_sequence WHERE singleton = 1")
        ).scalar_one()
        return int(allocated)
