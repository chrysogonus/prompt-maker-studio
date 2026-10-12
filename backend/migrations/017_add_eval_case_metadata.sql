-- Historical reference only — the executed migration lives in
-- backend/app/database/migrations/v017_eval_case_metadata.py (_migration_017_eval_case_metadata).

ALTER TABLE eval_cases ADD COLUMN name VARCHAR(100);
ALTER TABLE eval_cases ADD COLUMN intentionally_empty BOOLEAN NOT NULL DEFAULT 0;
