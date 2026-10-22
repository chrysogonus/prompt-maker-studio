-- Historical reference only; the application runs the idempotent Python migration.
CREATE TABLE IF NOT EXISTS public_billed_calls (
  id INTEGER PRIMARY KEY,
  source VARCHAR(30) NOT NULL,
  provider VARCHAR(30) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cost_usd FLOAT NOT NULL,
  created_at DATETIME
);
CREATE INDEX IF NOT EXISTS ix_public_billed_calls_id ON public_billed_calls (id);
CREATE INDEX IF NOT EXISTS ix_public_billed_calls_source ON public_billed_calls (source);
CREATE INDEX IF NOT EXISTS ix_public_billed_calls_created_at ON public_billed_calls (created_at);
