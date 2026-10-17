-- Historical reference only; the idempotent Python migration is authoritative.
ALTER TABLE prompts ADD COLUMN content_updated_at DATETIME;
UPDATE prompts SET content_updated_at = COALESCE(updated_at, created_at);
