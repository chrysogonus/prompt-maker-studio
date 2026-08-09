-- Migration 008: Add tags column to prompts table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/008_add_tags_to_prompts.sql
--
-- Stores a JSON list of free-text tag strings, mirroring the `fields` column.

ALTER TABLE prompts ADD COLUMN tags JSON;
