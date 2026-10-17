"""Add the optional Anthropic workspace selector to saved connections."""

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_029_user_llm_workspace(connection) -> None:
    if _table_exists(connection, "users"):
        _add_column_if_missing(connection, "users", "llm_workspace_id", "VARCHAR(100)")
