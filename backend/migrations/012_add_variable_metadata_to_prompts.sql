-- Migration 012: Add variable_metadata column to prompts table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/012_add_variable_metadata_to_prompts.sql
--
-- Stores a JSON object keyed by variable name, e.g.:
--   {"customer_name": {"type": "text", "description": "Who the email is addressed to"}}
-- `type` is one of "text" | "number" | "boolean" | "list".

ALTER TABLE prompts ADD COLUMN variable_metadata JSON;
