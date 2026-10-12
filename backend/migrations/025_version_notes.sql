-- Reference only; the Python runner performs the transactional note reassociation.
ALTER TABLE prompts ADD COLUMN current_note VARCHAR(255);
ALTER TABLE prompt_versions ADD COLUMN legacy_note VARCHAR(255);
ALTER TABLE prompt_versions ADD COLUMN variable_metadata JSON;
-- Copy every original note into legacy_note, then associate save/restore notes
-- with the next snapshot (or the live prompt for the last edit).
-- "Before section recovery" describes its snapshot and remains anchored there.
-- Older snapshots lack variable metadata; restoring them retains current settings.
