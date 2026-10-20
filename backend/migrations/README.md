# Database Migrations

The application uses SQLite by default. Fresh databases are created from the
SQLAlchemy models, and existing SQLite databases are upgraded on backend startup
by the idempotent migration runner in `app/database/migrations/runner.py`.

The `.sql` files in this directory are historical references. Use the tested
Python migration runner for upgrades; the SQL files are not a command interface. Migrations 020 and 021 are implemented only in Python.
The runner skips non-SQLite engines; it does not provide upgrades for another
database dialect.

## Current Migration Runner

On startup, `app.main.init_db()` calls:

1. `Base.metadata.create_all(...)` to create missing tables for fresh installs.
2. `run_migrations(engine)` to add/backfill columns that `create_all()` cannot
   change on existing SQLite tables.

The runner records completed versions in `schema_migrations` and is safe to run
multiple times. `app/database/migrations/registry.py` records the unchanged
version order; each `vNNN_*.py` module owns one historical step. Add new steps
to the registry rather than editing an applied migration. Migration 023 uses
frozen helpers in `recovery.py`, so future changes to live section rendering
cannot change its historical upgrade behavior.

It currently handles:

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
- `019_user_llm_connection` — adds `users.llm_provider`/`llm_base_url`/`llm_api_key_encrypted`/`llm_model` (the per-user bring-your-own provider connection; the key is Fernet ciphertext, never plaintext) and `billed_calls.provider` (pricing is per `(provider, model)`). Existing users are pre-filled with the `openai` provider and their previous `default_model`, but **no key** — the operator's shared credential is deliberately not copied into user rows, so users supply their own connection or use the optional server default.
- `020_delete_cascades` — removes orphaned user/prompt-owned records and rebuilds
  tables with database delete cascades (nullable historical author/case links use
  `SET NULL`). SQLite connections enable foreign keys; the runner temporarily
  disables enforcement on a dedicated connection for this rebuild. Deleting an
  account also removes its billed calls and therefore its contribution to the
  monthly global budget window.
- `021_user_token_version` — adds the account-wide session/OAuth revocation counter,
  with existing accounts starting at zero.
- `022_oauth_tables` — creates `oauth_clients`, `oauth_authorization_codes`, and `oauth_refresh_tokens` for MCP OAuth account linking (dynamic client registration, one-time authorization codes, rotating refresh tokens), with `ON DELETE CASCADE` from `users`. Codes and refresh tokens are stored as SHA-256 digests.
- `023_recover_drifted_prompt_sections` — makes every prompt's `fields` the source of its `generated_prompt`. Prompts whose stored text no longer matches their rendered fields (edited in the old raw-text editor) first get their original fields and text kept as a `prompt_versions` snapshot noted "Before section recovery"; their fields are then rebuilt from the text, split into sections only when that reproduces the text exactly, otherwise kept whole as one `prompt` section. `updated_at` is not changed.
- `024_recover_unnamed_prompts` — gives every unnamed (History-only) prompt a date-based name such as `Untitled (14 Mar 2026, 09:12 UTC)` and files it under "Recovered history" unless it already has a folder. Nothing is deduplicated.
- `025_version_notes` — associates save/restore notes with the resulting version and stores the newest note on `prompts.current_note`. Original notes remain in `prompt_versions.legacy_note` and the API/export; recovery snapshot notes stay anchored. New snapshots include variable settings. Older snapshots have no metadata, so restoring them retains current settings. Prompt text, IDs, evaluations and timestamps are untouched.
- `026_user_auth_subject` — assigns every existing account a unique UUID used by session and MCP access-token subjects. Subjects survive username changes and cannot follow a reused username or numeric row ID. Existing username-subject sessions must sign in again; MCP clients must renew their access token or reconnect.
- `027_oauth_grants` — creates `oauth_grants` with a revocation generation for each account/client pair and binds authorization codes and refresh tokens to it. Pending codes also retain the account version from approval. Legacy codes and refresh tokens without a grant version are cleared; old OAuth access tokens are rejected, so clients must reauthorize. Client registrations and other account data survive.

Migration 020 preserves the pre-025 note schema during its rebuild, so an upgrade that crosses both steps still runs the 025 backfill. This does not guess at repairs for note history already edited after an earlier skipped backfill; recover those records from a verified backup before changing them.

- `028_prompt_content_updated_at` — separates library content recency from the optimistic-concurrency update stamp. Existing rows keep their last known update (or creation) time; past organization-only activity cannot be reconstructed. New favorites, renames and folder changes leave content recency alone; section/variable edits and restores advance it.
- `029_user_llm_workspace` — adds nullable `users.llm_workspace_id` for optional Anthropic workspace selection. Existing connections retain their key and need no workspace unless the key grants access to multiple workspaces.
- `030_eval_human_score` — adds nullable `eval_run_results.human_score`: a person's own 1–5 star rating of an AI-reviewed result, stored as 20–100 beside the unchanged AI score. Existing results stay unrated; scores and run averages are untouched.

## Production Migration Checklist

For an explicitly approved production deployment with database changes:

1. Pull the release onto the server but do not restart the backend yet.
2. Create a backup:
   ```bash
   make backup-db
   ```
3. Confirm the backup exists under `backups/` and can be copied off-host.
4. Build or pull the approved release and recreate the backend using the
   matching source-build or published-image commands in the
   [deployment guide](../../docs/deployment.md#update-application). Startup
   runs pending migrations; `up -d` alone does not rebuild a changed source image.
5. Check backend JSON logs for `event="migration_applying"` followed by
   `event="migration_applied"` with the expected `migration_version` (for example,
   `020_delete_cascades`). Each applied event confirms the runner recorded that
   version. Already-applied migrations emit no new progress events on restart.
6. Verify the app health endpoint and one authenticated saved-prompt flow.
7. If validation fails, stop the backend and prepare the compatible previous
   image/build before restoring the pre-deploy backup:
   ```bash
   make restore-db BACKUP=backups/prompts-YYYYmmddTHHMMSSZ.sqlite3.gz
   ```
   This target stops the backend and backup worker, restores and verifies the
   database, then restarts the backend and any previously running backup worker.
   It starts the existing backend container, so recreate that container with the
   intended rollback image before restore; starting the failed release could
   immediately reapply its migrations.

## Local Verification

Run migration tests after changing the runner:

```bash
.venv/bin/pytest backend/tests/test_migrations.py backend/tests/test_backup_restore.py -q
```

The tests cover legacy-schema upgrade, idempotency, consistent backup creation,
and restore integrity checks.
