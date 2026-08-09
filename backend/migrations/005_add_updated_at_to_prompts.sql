-- Migration 005: Add updated_at column to prompts table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/005_add_updated_at_to_prompts.sql
--
-- Existing rows are backfilled with their created_at value.

ALTER TABLE prompts ADD COLUMN updated_at DATETIME;

UPDATE prompts SET updated_at = created_at WHERE updated_at IS NULL;
