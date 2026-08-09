-- Migration 011: Add Settings preference columns to users table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/011_add_user_preferences.sql
--
-- default_model is validated against the Playground's available model list
-- at the API layer, not enforced here. notify_weekly_summary is stored but
-- not yet actually sent — no scheduler exists in this codebase.

ALTER TABLE users ADD COLUMN default_model VARCHAR(100);
ALTER TABLE users ADD COLUMN notify_run_failure BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN notify_weekly_summary BOOLEAN NOT NULL DEFAULT 0;
