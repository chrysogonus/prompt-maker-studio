-- Historical reference only; the application runs the idempotent Python migration.
ALTER TABLE users ADD COLUMN last_mcp_use_date DATE;
ALTER TABLE users ADD COLUMN referral_source VARCHAR(30);
