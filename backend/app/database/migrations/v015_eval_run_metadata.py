"""Historical SQLite migration v015_eval_run_metadata."""

from __future__ import annotations

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_015_eval_run_metadata(connection) -> None:
    """Add reproducibility metadata to eval_runs (resolved model + aggregated
    cost/latency/tokens) and a per-result snapshot to eval_run_results
    (criteria/variables at run time, plus the judge model actually used) so
    later edits to an EvalCase don't retroactively change what a historical
    run appears to have tested."""
    if _table_exists(connection, "eval_runs"):
        _add_column_if_missing(connection, "eval_runs", "model", "VARCHAR(100) NOT NULL DEFAULT ''")
        _add_column_if_missing(
            connection, "eval_runs", "total_latency_ms", "INTEGER NOT NULL DEFAULT 0"
        )
        _add_column_if_missing(
            connection, "eval_runs", "total_prompt_tokens", "INTEGER NOT NULL DEFAULT 0"
        )
        _add_column_if_missing(
            connection, "eval_runs", "total_completion_tokens", "INTEGER NOT NULL DEFAULT 0"
        )
        _add_column_if_missing(connection, "eval_runs", "total_cost_usd", "REAL NOT NULL DEFAULT 0")

    if _table_exists(connection, "eval_run_results"):
        _add_column_if_missing(connection, "eval_run_results", "criteria", "TEXT")
        _add_column_if_missing(connection, "eval_run_results", "variables", "JSON")
        _add_column_if_missing(connection, "eval_run_results", "judge_model", "VARCHAR(100)")
