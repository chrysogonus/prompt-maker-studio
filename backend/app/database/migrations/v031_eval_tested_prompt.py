"""Record the exact prompt text each evaluation run tested."""

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_031_eval_tested_prompt(connection) -> None:
    if _table_exists(connection, "eval_runs"):
        _add_column_if_missing(connection, "eval_runs", "tested_prompt", "TEXT")
