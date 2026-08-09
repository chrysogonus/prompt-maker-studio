# Database Migrations

The application uses SQLite by default. Fresh databases are created from the
SQLAlchemy models, and existing SQLite databases are upgraded on backend startup
by the idempotent migration runner in `app/database/migrations.py`.

The `.sql` files in this directory are historical references. Do not run them
against production without reviewing dialect compatibility; the supported go-live
path is the tested Python migration runner.

## Current Migration Runner

On startup, `app.main.init_db()` calls:

1. `Base.metadata.create_all(...)` to create missing tables for fresh installs.
2. `run_migrations(engine)` to add/backfill columns that `create_all()` cannot
   change on existing SQLite tables.

The runner records completed versions in `schema_migrations` and is safe to run
multiple times. It currently handles:

- `001_dynamic_prompt_fields` — backfills `prompts.fields` from legacy static
  prompt columns when needed.
- `002_prompt_user_id` — adds prompt ownership and indexes it.
- `003_prompt_name` — adds saved-prompt names.
- `004_user_email_reset` — adds email and password-reset fields.
- `005_prompt_updated_at` — adds `prompts.updated_at`, backfilled from `created_at`.
- `006_prompt_folder` — adds `prompts.folder` (free-text label) and indexes it.
- `007_prompt_favorite` — adds `prompts.is_favorite`, defaulting existing rows to false.
- `008_prompt_tags` — adds `prompts.tags` (JSON list of free-text tag strings).
- `009_prompt_versions` — creates the `prompt_versions` table (historical snapshots) and indexes `prompt_id`.
- `010_playground_runs` — creates the `playground_runs` table (Playground execution history) and indexes `prompt_id`, `user_id`, `created_at`.
- `011_user_preferences` — adds `users.default_model`, `notify_run_failure`, `notify_weekly_summary`.
- `012_prompt_variable_metadata` — adds `prompts.variable_metadata` (JSON object keyed by variable name, storing `type`/`description` per variable).
- `013_user_eval_and_library_preferences` — adds `users.default_library_view`, `default_eval_method`, `auto_run_eval_on_update`, `notify_eval_complete`, `notify_eval_regression`.
- `014_eval_tables` — creates the `eval_cases`, `eval_runs`, and `eval_run_results` tables (Evaluate tab test cases, run history, and per-case results) and indexes `prompt_id`/`created_at`/`eval_run_id`.
- `015_eval_run_metadata` — adds `eval_runs.model`/`total_latency_ms`/`total_prompt_tokens`/`total_completion_tokens`/`total_cost_usd` (resolved execution model and aggregated usage across a run) and `eval_run_results.criteria`/`variables`/`judge_model` (per-case snapshot at run time, so later edits to an `EvalCase` don't retroactively change what a historical run tested).
- `016_billed_calls` — creates the `billed_calls` table (unified AI spend ledger: one row per billed LLM call from any feature) and indexes `user_id`/`source`/`created_at`. No backfill from `playground_runs`; ledger history starts at deploy time.
- `017_eval_case_metadata` — adds optional eval-case names and an `intentionally_empty` flag so robustness cases can explicitly suppress missing-variable warnings.
- `018_prompt_id_sequence` — creates a durable SQLite prompt-ID high-water mark so deleted prompt IDs are never reused by later prompts.
- `019_user_llm_connection` — adds `users.llm_provider`/`llm_base_url`/`llm_api_key_encrypted`/`llm_model` (the per-user bring-your-own provider connection; the key is Fernet ciphertext, never plaintext) and `billed_calls.provider` (pricing is per `(provider, model)`). Existing users are pre-filled with the `openai` provider and their previous `default_model`, but **no key** — the operator's shared credential is deliberately not copied into user rows, so each user re-enters their own.

## Production Migration Checklist

Before deploying a build with database changes:

1. Pull the release onto the server but do not restart the backend yet.
2. Create a backup:
   ```bash
   make backup-db
   ```
3. Confirm the backup exists under `backups/` and can be copied off-host.
4. Start or restart the backend so the migration runner executes:
   ```bash
   docker compose -f docker-compose.yml up -d backend
   ```
5. Check backend logs for `Applying database migration` / `Applied database migration` entries.
6. Verify the app health endpoint and one authenticated saved-prompt flow.
7. If validation fails, stop the backend and restore the pre-deploy backup:
   ```bash
   make restore-db BACKUP=backups/prompts-YYYYmmddTHHMMSSZ.sqlite3.gz
   ```

## Local Verification

Run migration tests after changing the runner:

```bash
.venv/bin/pytest backend/tests/test_migrations.py backend/tests/test_backup_restore.py -q
```

The tests cover legacy-schema upgrade, idempotency, consistent backup creation,
and restore integrity checks.
