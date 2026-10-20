-- Historical reference only; the application runs the idempotent Python migration.
ALTER TABLE eval_runs ADD COLUMN tested_prompt TEXT;
