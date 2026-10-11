"""Historical SQLite migration v023_recover_drifted_prompt_sections."""

from __future__ import annotations

from datetime import UTC, datetime
import json

from sqlalchemy import text

from app.database.migrations.helpers import _table_exists
from app.database.migrations.recovery import render_sections, sections_for_text

SECTION_RECOVERY_NOTE = "Before section recovery"


def _migration_023_recover_drifted_prompt_sections(connection) -> None:
    """Make every prompt's fields the source of its generated text.

    The saved-prompt editor PATCHed `generated_prompt` as raw text, so a prompt
    could drift from the fields it claims to be built from. From here on the
    server renders the text from the fields on every write, so each drifted
    prompt first gets its original fields and text kept as a version snapshot,
    then its fields are rebuilt from the text: split into sections when that
    round-trips exactly, otherwise kept whole as a single `prompt` section.
    Rows are rewritten without touching `updated_at`, so the library order the
    user knows does not change.
    """
    if not _table_exists(connection, "prompts"):
        return

    rows = connection.execute(
        text('SELECT id, user_id, fields, generated_prompt FROM "prompts"')
    ).mappings()
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f")
    for row in rows.all():
        fields = json.loads(row["fields"]) if isinstance(row["fields"], str) else row["fields"]
        original = row["generated_prompt"]
        if render_sections(fields) == original:
            continue

        recovered = sections_for_text(original, fields)
        next_version = connection.execute(
            text(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM prompt_versions "
                "WHERE prompt_id = :prompt_id"
            ),
            {"prompt_id": row["id"]},
        ).scalar_one()
        connection.execute(
            text(
                "INSERT INTO prompt_versions "
                "(prompt_id, version_number, note, author_user_id, fields, generated_prompt, "
                "created_at) "
                "VALUES (:prompt_id, :version_number, :note, :author_user_id, :fields, "
                ":generated_prompt, :created_at)"
            ),
            {
                "prompt_id": row["id"],
                "version_number": next_version,
                "note": SECTION_RECOVERY_NOTE,
                "author_user_id": row["user_id"],
                "fields": json.dumps(fields),
                "generated_prompt": original,
                "created_at": now,
            },
        )
        connection.execute(
            text(
                'UPDATE "prompts" SET fields = :fields, generated_prompt = :generated_prompt '
                "WHERE id = :prompt_id"
            ),
            {
                "fields": json.dumps(recovered),
                "generated_prompt": render_sections(recovered),
                "prompt_id": row["id"],
            },
        )
