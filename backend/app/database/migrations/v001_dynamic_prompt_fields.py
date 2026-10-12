"""Historical SQLite migration v001_dynamic_prompt_fields."""

from __future__ import annotations

import json

from sqlalchemy import text

from app.database.migrations.helpers import _columns, _table_exists

STATIC_FIELD_COLUMNS = ("goal", "characters", "style", "setting", "details", "extra_details")


def _migration_001_dynamic_prompt_fields(connection) -> None:
    """Backfill `prompts.fields` from legacy static field columns when needed."""
    if not _table_exists(connection, "prompts"):
        return

    columns = _columns(connection, "prompts")
    if "fields" in columns:
        return

    legacy_columns = [column for column in STATIC_FIELD_COLUMNS if column in columns]
    if not legacy_columns:
        msg = "Cannot migrate prompts table: missing both `fields` and legacy static field columns"
        raise RuntimeError(msg)

    connection.execute(text('ALTER TABLE "prompts" ADD COLUMN fields JSON'))

    rows = connection.execute(text('SELECT * FROM "prompts"')).mappings().all()

    for row in rows:
        fields = [
            {"name": column, "content": row[column]}
            for column in legacy_columns
            if row[column] not in (None, "")
        ]
        if not fields:
            fields = [{"name": "goal", "content": ""}]

        connection.execute(
            text('UPDATE "prompts" SET fields = :fields WHERE id = :prompt_id'),
            {"fields": json.dumps(fields), "prompt_id": row["id"]},
        )
