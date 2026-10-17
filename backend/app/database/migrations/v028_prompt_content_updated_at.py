"""Keep content recency independent of favorite and folder changes."""

from sqlalchemy import text

from app.database.migrations.helpers import _add_column_if_missing, _columns, _table_exists


def _migration_028_prompt_content_updated_at(connection) -> None:
    if not _table_exists(connection, "prompts"):
        return
    if "content_updated_at" in _columns(connection, "prompts"):
        return
    if not connection.connection.dbapi_connection.in_transaction:
        connection.exec_driver_sql("BEGIN")
    _add_column_if_missing(connection, "prompts", "content_updated_at", "DATETIME")
    # Historical updates did not distinguish organization from content edits.
    connection.execute(
        text("UPDATE prompts SET content_updated_at = COALESCE(updated_at, created_at)")
    )
