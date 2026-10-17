-- Historical reference only; the application runs the idempotent Python migration.
ALTER TABLE users ADD COLUMN llm_workspace_id VARCHAR(100);
