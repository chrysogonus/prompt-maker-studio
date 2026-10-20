-- Historical reference only; the application runs the idempotent Python migration.
ALTER TABLE eval_run_results ADD COLUMN human_score FLOAT;
