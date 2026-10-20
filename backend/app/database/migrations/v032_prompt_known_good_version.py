"""Let a prompt name one version as known good."""

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_032_prompt_known_good_version(connection) -> None:
    if _table_exists(connection, "prompts"):
        _add_column_if_missing(connection, "prompts", "known_good_version", "INTEGER")
