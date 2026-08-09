-- Migration 006: Add folder column to prompts table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/006_add_folder_to_prompts.sql
--
-- Free-text organizational label shown as a folder badge in the Library.

ALTER TABLE prompts ADD COLUMN folder VARCHAR(255);

CREATE INDEX IF NOT EXISTS ix_prompts_folder ON prompts (folder);
