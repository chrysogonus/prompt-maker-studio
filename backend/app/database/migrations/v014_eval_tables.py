"""Historical SQLite migration v014_eval_tables."""

from __future__ import annotations

from sqlalchemy import text


def _migration_014_eval_tables(connection) -> None:
    """Create the eval_cases, eval_runs, and eval_run_results tables for the Evaluate tab."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS eval_cases ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "prompt_id INTEGER NOT NULL REFERENCES prompts(id), "
            "method VARCHAR(20) NOT NULL, "
            "criteria TEXT, "
            "variables JSON, "
            "position INTEGER NOT NULL DEFAULT 0, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_eval_cases_prompt_id ON eval_cases (prompt_id)")
    )

    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS eval_runs ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "prompt_id INTEGER NOT NULL REFERENCES prompts(id), "
            "prompt_version_number INTEGER NOT NULL DEFAULT 0, "
            "score REAL, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_eval_runs_prompt_id ON eval_runs (prompt_id)")
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_eval_runs_created_at ON eval_runs (created_at)")
    )

    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS eval_run_results ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id), "
            "eval_case_id INTEGER REFERENCES eval_cases(id), "
            "method VARCHAR(20) NOT NULL, "
            "label TEXT NOT NULL, "
            "rationale TEXT, "
            "score REAL, "
            "is_pending BOOLEAN NOT NULL DEFAULT 0, "
            "output_text TEXT"
            ")"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_eval_run_results_eval_run_id "
            "ON eval_run_results (eval_run_id)"
        )
    )
