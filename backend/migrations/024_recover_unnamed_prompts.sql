-- Historical reference only — the executed migration lives in
-- backend/app/database/migrations/v024_recover_unnamed_prompts.py (_migration_024_recover_unnamed_prompts).
--
-- Unnamed prompts were only listed by the retired History tab. Each gets a
-- date-based name, e.g. 'Untitled (14 Mar 2026, 09:12 UTC)' (the Python step
-- drops the day's leading zero), and the 'Recovered history' folder unless it
-- is already filed. No deduplication.

UPDATE prompts
SET name = CASE
        WHEN created_at IS NULL THEN 'Untitled'
        ELSE 'Untitled (' || strftime('%d', created_at) || ' '
            || substr('JanFebMarAprMayJunJulAugSepOctNovDec',
                      (CAST(strftime('%m', created_at) AS INTEGER) - 1) * 3 + 1, 3)
            || ' ' || strftime('%Y, %H:%M', created_at) || ' UTC)'
    END,
    folder = COALESCE(folder, 'Recovered history')
WHERE name IS NULL;
