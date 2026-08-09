-- Migration 013: Add Settings preference columns for Library default view
-- and the Evaluate feature to users table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/013_add_user_eval_and_library_preferences.sql
--
-- default_library_view and default_eval_method are validated against a
-- fixed set of literal values at the API layer, not enforced here.

ALTER TABLE users ADD COLUMN default_library_view VARCHAR(10);
ALTER TABLE users ADD COLUMN default_eval_method VARCHAR(20);
ALTER TABLE users ADD COLUMN auto_run_eval_on_update BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN notify_eval_complete BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN notify_eval_regression BOOLEAN NOT NULL DEFAULT 0;
