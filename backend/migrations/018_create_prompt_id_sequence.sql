-- Historical reference only — the executed migration lives in
-- backend/app/database/migrations.py (_migration_018_prompt_id_sequence).

CREATE TABLE IF NOT EXISTS prompt_id_sequence (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_id INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO prompt_id_sequence (singleton, last_id)
SELECT 1, COALESCE(MAX(id), 0) FROM prompts;
