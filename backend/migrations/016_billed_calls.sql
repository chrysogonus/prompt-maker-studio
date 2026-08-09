-- Historical reference only — the executed migration lives in
-- backend/app/database/migrations.py (_migration_016_billed_calls).
--
-- Unified AI spend ledger: one row per billed OpenAI call from any feature
-- (Playground, eval case runs, judge grading, eval-case generation,
-- refinement, AI import). BudgetService and Dashboard spend now read this
-- table instead of playground_runs.cost_usd. No backfill from
-- playground_runs: ledger history starts at deploy time.

CREATE TABLE IF NOT EXISTS billed_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    source VARCHAR(30) NOT NULL,
    model VARCHAR(100) NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at DATETIME
);

CREATE INDEX IF NOT EXISTS ix_billed_calls_user_id ON billed_calls (user_id);
CREATE INDEX IF NOT EXISTS ix_billed_calls_source ON billed_calls (source);
CREATE INDEX IF NOT EXISTS ix_billed_calls_created_at ON billed_calls (created_at);
