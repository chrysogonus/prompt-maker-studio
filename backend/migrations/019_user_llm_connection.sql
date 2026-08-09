-- Historical reference only — the executed migration lives in
-- backend/app/database/migrations.py (_migration_019_user_llm_connection).

ALTER TABLE users ADD COLUMN llm_provider VARCHAR(30);
ALTER TABLE users ADD COLUMN llm_base_url VARCHAR(500);
ALTER TABLE users ADD COLUMN llm_api_key_encrypted TEXT;
ALTER TABLE users ADD COLUMN llm_model VARCHAR(200);

-- Point existing accounts at OpenAI with whatever model they already
-- preferred, so the Settings connection form opens populated. Deliberately no
-- API key: provider credentials are bring-your-own, and copying the operator's
-- shared key into every user row would be worse than a signposted empty state.
UPDATE users
SET llm_provider = 'openai',
    llm_model = COALESCE(default_model, 'gpt-4o-mini')
WHERE llm_provider IS NULL;

-- Pricing is per (provider, model). Every pre-existing billed call went
-- through the operator's OpenAI key, so this backfill is accurate.
ALTER TABLE billed_calls ADD COLUMN provider VARCHAR(30) NOT NULL DEFAULT 'openai';
