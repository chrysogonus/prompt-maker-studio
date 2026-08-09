-- Migration 002: Add user_id foreign key to prompts table
--
-- Existing rows (if any) must be assigned to a user before this migration
-- can be applied in a production environment.  The UPDATE below assigns all
-- ownerless prompts to the oldest user as a safe default; review and adjust
-- before running against live data.

BEGIN;

-- Step 1: Add the column as nullable so existing rows are not immediately rejected
ALTER TABLE prompts
    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Step 2: Assign any ownerless prompts to the oldest existing user
UPDATE prompts
SET user_id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
WHERE user_id IS NULL;

-- Step 3: Enforce NOT NULL now that all rows have an owner
ALTER TABLE prompts
    ALTER COLUMN user_id SET NOT NULL;

-- Step 4: Index for fast per-user history queries
CREATE INDEX IF NOT EXISTS ix_prompts_user_id ON prompts (user_id);

COMMIT;
