-- Migration 004: Add email and password-reset columns to users table
--
-- Apply with:
--   sqlite3 /app/data/prompts.db < migrations/004_add_password_reset.sql
--
-- All new columns are nullable so existing rows remain valid without data migration.

ALTER TABLE users ADD COLUMN email VARCHAR(255);
ALTER TABLE users ADD COLUMN reset_token VARCHAR(255);
ALTER TABLE users ADD COLUMN reset_token_expiry DATETIME;

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email
    ON users (email)
    WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_users_reset_token
    ON users (reset_token)
    WHERE reset_token IS NOT NULL;
