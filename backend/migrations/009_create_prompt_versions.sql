-- Migration 009: Create prompt_versions table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/009_create_prompt_versions.sql
--
-- Stores historical snapshots of a prompt's fields/generated_prompt,
-- captured just before an edit overwrites the live `prompts` row.

CREATE TABLE IF NOT EXISTS prompt_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_id INTEGER NOT NULL REFERENCES prompts(id),
    version_number INTEGER NOT NULL,
    note VARCHAR(255),
    author_user_id INTEGER REFERENCES users(id),
    fields JSON NOT NULL,
    generated_prompt TEXT NOT NULL,
    created_at DATETIME
);

CREATE INDEX IF NOT EXISTS ix_prompt_versions_prompt_id ON prompt_versions (prompt_id);
