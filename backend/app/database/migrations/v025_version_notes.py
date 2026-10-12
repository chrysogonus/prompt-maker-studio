"""Associate historical edit notes with the state produced by the edit."""

from sqlalchemy import text

from app.database.migrations.helpers import _add_column_if_missing, _columns, _table_exists


def _migration_025_version_notes(connection) -> None:
    # Explicit BEGIN makes SQLite DDL and note backfill roll back together.
    if not connection.connection.dbapi_connection.in_transaction:
        connection.exec_driver_sql("BEGIN")
    if not _table_exists(connection, "prompts"):
        return
    _add_column_if_missing(connection, "prompts", "current_note", "VARCHAR(255)")
    if not _table_exists(connection, "prompt_versions"):
        return
    # The column also guards direct reruns and a crash before the runner records its ID.
    already_upgraded = "legacy_note" in _columns(connection, "prompt_versions")
    _add_column_if_missing(connection, "prompt_versions", "legacy_note", "VARCHAR(255)")
    _add_column_if_missing(connection, "prompt_versions", "variable_metadata", "JSON")
    if already_upgraded:
        return
    rows = (
        connection.execute(
            text(
                "SELECT id, prompt_id, note FROM prompt_versions ORDER BY prompt_id, version_number"
            )
        )
        .mappings()
        .all()
    )
    previous: dict[int, str | None] = {}
    for row in rows:
        # The recovery migration describes the snapshot itself, unlike save/restore notes.
        recovery = row["note"] == "Before section recovery"
        connection.execute(
            text("UPDATE prompt_versions SET legacy_note = :original, note = :note WHERE id = :id"),
            {
                "id": row["id"],
                "original": row["note"],
                "note": previous.get(row["prompt_id"]) or (row["note"] if recovery else None),
            },
        )
        previous[row["prompt_id"]] = None if recovery else row["note"]
    for prompt_id, note in previous.items():
        connection.execute(
            text("UPDATE prompts SET current_note = :note WHERE id = :id"),
            {"id": prompt_id, "note": note},
        )
