-- Migration 010: Create playground_runs table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/010_create_playground_runs.sql
--
-- Records each Playground execution attempt (success or failure) for
-- Playground output history and Dashboard usage analytics.

CREATE TABLE IF NOT EXISTS playground_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_id INTEGER NOT NULL REFERENCES prompts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    model VARCHAR(100) NOT NULL,
    input_variables JSON,
    output_text TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'success',
    error_message TEXT,
    created_at DATETIME
);

CREATE INDEX IF NOT EXISTS ix_playground_runs_prompt_id ON playground_runs (prompt_id);
CREATE INDEX IF NOT EXISTS ix_playground_runs_user_id ON playground_runs (user_id);
CREATE INDEX IF NOT EXISTS ix_playground_runs_created_at ON playground_runs (created_at);
