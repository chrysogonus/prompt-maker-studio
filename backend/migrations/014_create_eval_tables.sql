-- Migration 014: Create eval_cases, eval_runs, and eval_run_results tables
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/014_create_eval_tables.sql
--
-- Supports the Evaluate tab: per-prompt test cases (rule/judge/manual
-- scoring methods) and run history with per-case results.

CREATE TABLE IF NOT EXISTS eval_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_id INTEGER NOT NULL REFERENCES prompts(id),
    method VARCHAR(20) NOT NULL,
    criteria TEXT,
    variables JSON,
    position INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME
);

CREATE INDEX IF NOT EXISTS ix_eval_cases_prompt_id ON eval_cases (prompt_id);

CREATE TABLE IF NOT EXISTS eval_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_id INTEGER NOT NULL REFERENCES prompts(id),
    prompt_version_number INTEGER NOT NULL DEFAULT 0,
    score REAL,
    created_at DATETIME
);

CREATE INDEX IF NOT EXISTS ix_eval_runs_prompt_id ON eval_runs (prompt_id);
CREATE INDEX IF NOT EXISTS ix_eval_runs_created_at ON eval_runs (created_at);

CREATE TABLE IF NOT EXISTS eval_run_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id),
    eval_case_id INTEGER REFERENCES eval_cases(id),
    method VARCHAR(20) NOT NULL,
    label TEXT NOT NULL,
    rationale TEXT,
    score REAL,
    is_pending BOOLEAN NOT NULL DEFAULT 0,
    output_text TEXT
);

CREATE INDEX IF NOT EXISTS ix_eval_run_results_eval_run_id ON eval_run_results (eval_run_id);
