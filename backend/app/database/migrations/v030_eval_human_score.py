"""Store a person's own rating of an AI-reviewed eval result."""

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_030_eval_human_score(connection) -> None:
    if _table_exists(connection, "eval_run_results"):
        _add_column_if_missing(connection, "eval_run_results", "human_score", "FLOAT")
