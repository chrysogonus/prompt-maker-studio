-- Migration 007: Add is_favorite column to prompts table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/007_add_favorite_to_prompts.sql
--
-- Existing rows default to not-favorited.

ALTER TABLE prompts ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT 0;
