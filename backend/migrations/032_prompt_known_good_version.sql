-- Historical reference only; the application runs the idempotent Python migration.
ALTER TABLE prompts ADD COLUMN known_good_version INTEGER;
