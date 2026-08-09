-- Migration 003: Add name column to prompts table
--
-- A prompt with a non-null name is considered a "saved" prompt and appears
-- in the user's saved-prompts sidebar. Unnamed prompts are history-only.
--
-- SQLite: ALTER TABLE ... ADD COLUMN is supported since SQLite 3.1.3.
-- PostgreSQL: The column is added nullable so no backfill is required.

ALTER TABLE prompts ADD COLUMN name VARCHAR(255);

-- Index on name speeds up the GET /api/prompts/saved query which filters
-- WHERE name IS NOT NULL. SQLite and PostgreSQL both support partial indexes,
-- but to keep the migration cross-dialect we use a plain index.
CREATE INDEX IF NOT EXISTS ix_prompts_name ON prompts (name);
