# Product & Architecture Decisions

Lightweight decision log (ADR-style). Records significant choices and their rationale to guide future development.

> Last reviewed against the codebase: 2026-07-26.

---

## Dynamic JSONB Fields for Prompts — Migration 001

**Status**: Accepted

**Context**: The original schema used fixed columns for prompt fields. As the product evolved, the number and names of fields became user-defined, making a fixed-column schema unworkable.

**Decision**: Replace fixed prompt columns with a single `fields` JSONB column storing an array of `{name, content}` objects.

**Rationale**: A dynamic field model is the core product primitive — users define their own field names. JSONB (with SQLite JSON fallback) provides flexibility without requiring a schema migration per new field type. A Pydantic validator enforces uniqueness of field names at the application layer.

**Consequences**: Prompt fields cannot be queried individually at the database level without JSON path operators. Full-text search on field contents requires application-layer filtering or a dedicated search index.

**Source**: `backend/migrations/001_migrate_to_dynamic_fields.sql`

---

## User Ownership on Prompts — Migration 002

**Status**: Accepted

**Context**: Prompts initially had no owner. As authentication was added, all data needed to be scoped to the authenticated user.

**Decision**: Add a `user_id` foreign key to the `prompts` table; backfill existing rows to the oldest user; enforce NOT NULL going forward.

**Rationale**: User-scoped data is a security and privacy requirement. Ownership enforcement prevents users from reading or modifying each other's prompts. The backfill strategy (assign to oldest user) was chosen as a safe default for existing data during migration.

**Consequences**: Prompt data operations require an authenticated user. The ownership check helper in `routes.py` returns HTTP 404 for both missing prompts and prompts not owned by the requesting user. `GET /api/prompts/config` was originally an intentionally public capability check; it became authenticated when bring-your-own providers made capability state user-specific (see the superseding decision below).

**Source**: `backend/migrations/002_add_user_id_to_prompts.sql`, `backend/app/api/routes.py`

---

## JWT Authentication over Session Cookies

**Status**: Superseded (2026-07-27) by "httpOnly Session Cookies over localStorage Tokens" below

**Context**: The app needs to authenticate users across a decoupled frontend (Next.js) and backend (FastAPI). Both stateless (JWT) and stateful (session/cookie) approaches were possible.

**Decision**: Use stateless JWT tokens stored in `localStorage` on the frontend; passed as HTTP Bearer tokens on each request.

**Rationale**: JWTs work cleanly across separate frontend and backend services without shared session storage. The decoupled architecture (separate Docker containers, Caddy routing) makes stateless tokens operationally simpler.

**Consequences**: Tokens cannot be invalidated server-side before expiry (no token revocation list). If a token is stolen, it is valid until expiry. Users who clear localStorage lose their session. A rotating refresh-token scheme is not implemented, but since 2026-07-19 an authenticated sliding-renewal endpoint (`POST /api/auth/refresh`) lets an active client exchange a still-valid token for a fresh one — renewal requires possession of an unexpired token, so absolute lockout after expiry is preserved.

**Source**: `backend/app/auth/utils.py`, `frontend/src/lib/auth.ts`

---

## httpOnly Session Cookies over localStorage Tokens

**Status**: Accepted (2026-07-27)

**Context**: A UI/UX audit flagged that the JWT lived in `localStorage` under
`auth_token`, which makes it readable by any script that reaches the page — an
XSS anywhere in the app, or in a dependency, could exfiltrate a valid session.
The stateless-JWT decision above is unchanged; only its *delivery* is.

**Decision**: Deliver the same JWT in an httpOnly, SameSite=Lax cookie. Login
and refresh no longer return `access_token` in the body — only `expires_at`,
which the UI needs for its timeout warning and which discloses nothing. Because
the browser now attaches the credential automatically, cookie-authenticated
writes carry a double-submit CSRF token (`X-CSRF-Token` header matched against
a readable `csrf_token` cookie). `Authorization: Bearer` is still accepted, and
is exempt from CSRF, since a browser never sets that header on its own.

**Rationale**: httpOnly is the one storage a page script cannot read, so it
removes token theft from the XSS blast radius. Lax rather than Strict, and a
`COOKIE_DOMAIN` on the shared parent, because the app and API sit on sibling
subdomains — those requests are same-site, so Lax still sends the cookie while
genuinely cross-site requests do not. Keeping the bearer path avoids breaking
scripts and CI, and costs nothing: nothing stores a readable token any more.

**Consequences**: Two new required settings in production, `COOKIE_DOMAIN` and
`COOKIE_SECURE` — a deployment that omits `COOKIE_DOMAIN` will authenticate on
the API subdomain but not the app. Plain-HTTP environments (local dev, the E2E
stack) must set `COOKIE_SECURE=false` or every request looks signed out.
`CORS_ORIGINS` can no longer be a wildcard, because credentialed CORS forbids
it. The client can no longer tell whether it is signed in without asking the
server: `isAuthenticated()` is now a hint derived from the stored expiry, and
`GET /api/auth/me` is what settles it.

**Source**: `backend/app/auth/cookies.py`, `backend/app/auth/dependencies.py`,
`frontend/src/lib/auth.ts`, `docs/authentication.md`

---

## Server-Side Saved Prompts

**Status**: Accepted — supersedes the earlier localStorage-only decision

**Context**: Saved prompts need to survive browser changes, localStorage clearing, and device switches. The previous client-side-only design was useful for early iteration but was not reliable enough for go-live.

**Decision**: Store saved prompts as backend `Prompt` records with a non-null `name`, scoped by authenticated `user_id`.

**Rationale**: Server-side persistence gives users consistent access across browsers and devices, keeps ownership enforcement in the backend, and allows backup/restore through the database volume.

**Consequences**: Saved prompts now depend on database availability and migration correctness. Production deployments need reliable database backups and tested restores.

**Source**: `backend/app/api/routes.py`, `backend/app/models/prompt.py`, `frontend/src/app/(app)/library/page.tsx`, `frontend/src/lib/api.ts`, `docs/saved-prompts.md`

---

## OpenAI Model Pinning for parse-text

**Status**: Superseded by "Bring-Your-Own LLM Provider over an OpenAI-Compatible Transport" (below) — there is no pinned model any more; every AI call runs on whatever model the acting user's own connection specifies

**Context**: The AI text import feature calls OpenAI's API for structured JSON output. A specific model must be selected.

**Decision**: Pin the model to `gpt-4.1-mini-2025-04-14`.

**Rationale**: Pinning a specific model version ensures deterministic behavior. `gpt-4.1-mini` provides a good cost/quality tradeoff for the structured-output parsing use case.

**Consequences**: The model would eventually be deprecated by OpenAI, and the pin needed periodic review. **Removed**: with bring-your-own providers the model is a per-user setting, so there is nothing central to pin or review — but there is still no fallback model, and a model name the user's provider does not serve now fails with an actionable "check it in Settings" error rather than a generic upstream failure.

**Source**: `backend/app/services/prompt_parser.py`

---

## Rate Limiting via SlowAPI

**Status**: Accepted

**Context**: The authentication and prompt generation endpoints are exposed to the internet and must be protected against brute-force and abuse.

**Decision**: Apply per-route rate limits using SlowAPI: register 5/min, login 10/min, parse-text 20/min, generate 30/min.

**Rationale**: SlowAPI integrates directly with FastAPI and provides decorator-based per-route limits with minimal overhead. The limits chosen reflect: tighter limits on auth endpoints (brute-force protection) and higher limits on operational endpoints (normal usage headroom).

**Consequences**: Legitimate users who burst-generate prompts may hit the generate limit. The limits should be tuned based on observed usage patterns. Behind Caddy in production, the client IP is extracted from forwarded headers — this must be correctly configured to avoid all requests appearing as the same IP.

**Source**: `backend/app/limiter.py`, `backend/app/api/routes.py`, `backend/app/api/auth_routes.py`

---

## SQLite as Primary Database

**Status**: Accepted — suitable for current scale

**Context**: The application needs a relational database with JSON support. PostgreSQL and SQLite were both options given the SQLAlchemy ORM in use.

**Decision**: Use SQLite as the primary database.

**Rationale**: SQLite requires no separate database service, simplifying local development and Docker deployment. The current user base and data volume do not require PostgreSQL's concurrency or replication features. SQLAlchemy's abstraction means migration to PostgreSQL is possible without changing application code, only the connection string.

**Consequences**: SQLite has limited concurrency (single writer). High concurrent write throughput will require a move to PostgreSQL. JSONB support in SQLite is handled via a compatibility shim in the model — behavior may differ subtly from native PostgreSQL JSONB.

**Source**: `backend/app/database/connection.py`, `backend/app/models/prompt.py`

---

## Lightweight Idempotent SQLite Database Migrations

**Status**: Accepted

**Context**: As new columns and constraints are added to SQLite database tables during active feature development, `SQLAlchemy.metadata.create_all()` is insufficient for upgrading existing databases. However, integrating full-blown migrations frameworks like Alembic adds significant operational complexity and overhead for a simple SQLite setup.

**Decision**: Implement a custom, lightweight, and idempotent migration runner (`backend/app/database/migrations.py`) executed automatically at FastAPI startup.

**Rationale**: A lightweight runner written directly in Python maintains a minimal runtime and dependency footprint. Idempotent check functions (e.g. checking `PRAGMA table_info` and tracking applied schema versions in a `schema_migrations` table) ensure that migrations can be run repeatedly without causing errors or data loss, even if schema columns or indices are already present.

**Consequences**: The migration framework is tailored for SQLite only. Complex migrations (such as dropping columns or altering constraints in ways not natively supported by SQLite) require manual table rebuilding scripts. If the application is migrated to PostgreSQL in the future, migrations will need to be transitioned to a compatible system (e.g. Alembic).

**Source**: `backend/app/database/migrations.py`, `backend/app/main.py`

---

## Force Re-login After Username Change

**Status**: Accepted

**Context**: Users can change their username via `PATCH /api/auth/me`. The JWT token encodes `username` as the `sub` claim. After a username change, the existing token still references the old username, which no longer matches the stored user record — causing all subsequent authenticated requests to fail silently or with confusing 401 errors.

**Decision**: After a successful username change, the frontend explicitly calls `handleLogout()` to clear the token and redirect the user to the login screen.

**Rationale**: Forcing re-authentication is the safest and most transparent response to credential change. Silent continuation would leave the user with a broken session. Alternatives (token refresh, new token returned from the PATCH endpoint) were ruled out because the current architecture has no token refresh mechanism and returning a new token from a profile update endpoint is an unusual pattern that adds security surface.

**Consequences**: Every username change requires the user to log back in with their new username. This is a known friction point — users should be warned in the UI before confirming the change. The sliding-renewal endpoint added 2026-07-19 (`POST /api/auth/refresh`) does not change this: it re-issues a token for the *same* subject, and after a username change the old subject no longer matches the user record, so forced re-login remains the correct behavior. This decision would only need revisiting if tokens moved to a stable subject (e.g. user ID).

**Source**: `backend/app/api/auth_routes.py`, `backend/app/models/schemas.py`, `frontend/src/app/(app)/settings/page.tsx`

---

## Explicit `updated_at` Assignment vs. SQLAlchemy `onupdate`

**Status**: Accepted

**Context**: The `updated_at` column on the `prompts` table must be set whenever a prompt is updated via `PATCH /api/prompts/{id}`. SQLAlchemy supports an `onupdate` hook on column definitions that fires automatically on ORM `UPDATE` operations.

**Decision**: Explicitly set `prompt.updated_at = datetime.now(UTC)` inside the `update_prompt` route handler before `db.commit()`, rather than relying on `Column(..., onupdate=...)`.

**Rationale**: SQLAlchemy's `onupdate` hook does not fire in all circumstances — specifically it is bypassed when `db.execute()` raw SQL is used, or when the ORM session bulk-updates without going through individual model instances. Explicit assignment in the route handler is predictable, visible, and testable. It also makes the intent clear to future maintainers.

**Consequences**: Any future code path that updates a prompt record must remember to set `updated_at` manually. If a bulk update pathway is added later, it must explicitly include the timestamp.

**Source**: `backend/app/api/routes.py`, `backend/app/models/prompt.py`

---

## SQLite Automated Consistent Backups and Atomic Restores

**Status**: Accepted

**Context**: Backing up SQLite databases by copying the active database file can result in corrupted backups if copy operations coincide with write transactions. Similarly, restoring a database by directly overwriting the file can cause corruption or crash active connections.

**Decision**: Provide standalone maintenance CLI scripts (`backup_sqlite.py` and `restore_sqlite.py`) using native SQLite connection-level copy and atomic file replacement techniques.

**Rationale**: `sqlite3.Connection.backup()` is the safe, native SQLite way to perform non-blocking online backups while preserving transaction consistency. On restore, checking the integrity of the backup file first (`PRAGMA integrity_check`) protects against corrupting the application state. Saving a timestamped backup of the current database before doing an atomic replace (using Python's `os.replace` / `Path.replace`) ensures the operation is atomic and reversible.

**Consequences**: Administrators must run backup/restore scripts as separate processes (e.g. via cron jobs or manually). The backup directory must be mapped outside the Docker container for persistence.

**Source**: `scripts/backup_sqlite.py`, `scripts/restore_sqlite.py`

---

## Dedicated Password-Change Endpoint over Extending Profile Update

**Status**: Accepted

**Context**: The only existing way to set a new password was the unauthenticated email reset flow (`forgot-password` → `reset-password`). Adding an in-app change for already-logged-in users meant choosing between extending `PATCH /api/auth/me` (which currently only handles email/username) or adding a separate endpoint.

**Decision**: Add a dedicated `POST /api/auth/change-password`, verifying `current_password` against the stored hash before accepting `new_password`.

**Rationale**: This codebase already treats password-related actions (`forgot-password`, `reset-password`) as distinct, verb-named endpoints separate from profile updates. A credential change is more security-sensitive than an email/username edit — it deserves its own rate-limit tier (5/min, matching `register`) and its own explicit current-password check, rather than being one more optional field on a general-purpose PATCH.

**Consequences**: Unlike a username change, a password change does **not** force re-login — the JWT subject is the username, which a password change does not affect, so the existing token remains valid. Any future auth endpoint should follow this same verb-endpoint convention rather than growing `PATCH /api/auth/me`.

**Source**: `backend/app/api/auth_routes.py`, `backend/app/models/schemas.py`

---

## Unauthenticated Capability-Check Endpoint (`GET /api/prompts/config`)

**Status**: Superseded by "Bring-Your-Own LLM Provider over an OpenAI-Compatible Transport" (below) — the endpoint is now authenticated, because AI capability became a per-user question

**Context**: If `OPENAI_API_KEY` is unset on the backend, the AI text importer only found out when a user actually submitted text, surfacing a generic 502. The frontend needed a way to know in advance whether AI import is usable.

**Decision**: Add `GET /api/prompts/config` returning an `openai_available` boolean and, when configured, the supported `available_models`; deliberately keep it **outside** authentication and rate limiting as the one exception to "everything in `routes.py` requires auth."

**Rationale**: The endpoint reveals no secret — only capability metadata already embodied by the UI — and gating the check behind login adds complexity without a security benefit. AI import fails open if the check errors, while the Playground uses the returned model list to avoid presenting unsupported choices.

**Consequences**: Any future capability endpoint following this pattern must stay similarly minimal: capability flags and public option identifiers only, with no secrets or operational diagnostics. **Changed**: once provider credentials became per-user, "is AI available" stopped having a global answer, so the endpoint now requires authentication and reports the caller's own connection (`provider_connected`, `provider`, `model`) instead of `openai_available`. The minimality rule still holds — it returns no credential, only the provider handle, label, and model name.

**Source**: `backend/app/api/routes.py`, `frontend/src/components/PromptImporter.tsx`

---

## Dual Instrumentation Point for `prompts_saved_total`

**Status**: Accepted

**Context**: Adding a business metric for "how many prompts get saved" is ambiguous in this codebase: a prompt becomes "saved" (non-null `name`) either at creation time (`POST /api/prompts/generate` with a `name` in the body — possible via the public API even though today's frontend never does this) or later via `PATCH /api/prompts/{id}` when a previously-unnamed prompt is given a name.

**Decision**: Increment `prompts_saved_total` in both `generate_prompt` (when `body.name is not None`) and `update_prompt` — but in the latter, only when the prompt's name transitions from `None` to non-`None` (captured as `was_unnamed` before the mutation), not on every rename.

**Rationale**: Instrumenting only one code path would undercount saves that happen through the other. The `was_unnamed` guard is essential: without it, renaming an already-saved prompt (a routine action) would inflate the counter every time, making the metric useless for tracking genuine new-save events.

**Consequences**: Any future code path that can set a prompt's `name` (e.g. a bulk-import feature) must apply the same "was it null before" guard to keep this counter meaningful.

**Source**: `backend/app/api/routes.py`, `backend/tests/test_metrics.py`

---

## Playground Uses the Operator's OpenAI Key, Not a Per-User Key

**Status**: Superseded by "Bring-Your-Own LLM Provider over an OpenAI-Compatible Transport" (below)

**Context**: The Claude-design mockup for the Playground screen depicted a Settings "API access" section with a masked key, reveal/copy, and regenerate controls — implying each user brings their own OpenAI key. This app has always used a single operator-configured `OPENAI_API_KEY` environment variable for the AI-import feature; there is no per-user credential storage anywhere in the schema.

**Decision**: The Playground reuses the existing operator key. Settings' "API access" section is read-only status (`Connected` / `Not configured`) — no reveal, copy, or regenerate, since there is no user-owned secret to show.

**Rationale**: Building per-user BYO-key storage (encryption at rest, key rotation, per-user billing exposure) is a materially larger and more security-sensitive feature than "let a user test a prompt." Reusing the existing capability-check pattern (`GET /api/prompts/config`, already used by the AI importer) keeps the Playground consistent with how the rest of the app already handles this exact dependency.

**Consequences**: All Playground runs across all users drew on the same operator API budget and rate limit, with no per-user cost isolation. **Reversed**: per-user bring-your-own credentials shipped, and the operator key was removed entirely — see "Bring-Your-Own LLM Provider over an OpenAI-Compatible Transport" below for what replaced this and why.

**Source**: `backend/app/services/playground_service.py`, `backend/app/api/routes.py` (`GET /api/prompts/config`), `frontend/src/app/(app)/settings/page.tsx`

---

## Dashboard "Success Rate" Means Playground Runs Without Error

**Status**: Accepted

**Context**: The source mockup's Dashboard stat card was labeled "Success rate" with the hint "valid JSON / schema match" — implying the product enforces a JSON output schema. This app's core output format is XML (`prompt_generator.py` wraps fields in uppercase XML tags); there is no JSON schema anywhere in the generation path.

**Decision**: Redefine "success rate" as the percentage of Playground runs (`playground_runs.status == 'success'`) that completed without an error, and reworded the Dashboard copy accordingly — dropping the "JSON / schema match" language entirely.

**Rationale**: Copying the mockup's literal wording would have required either building a JSON-schema validation feature no one asked for, or silently mislabeling a different metric as schema validation. Redefining the stat to something the app can genuinely compute keeps the number honest.

**Consequences**: If multiple output formats are ever added (see `product/ROADMAP.md`), this stat's definition should be revisited — it may make sense to track format-specific validity then.

**Source**: `backend/app/services/analytics_service.py`, `frontend/src/app/(app)/page.tsx`

---

## Weekly-Summary Notification Is Stored, Not Sent

**Status**: Superseded 2026-07-12 — see "Weekly-Summary Email Delivery via Cron-Invoked Script" below

**Context**: The Settings Notifications mockup showed both a "Run failures" and a "Weekly summary" toggle as equivalent, working controls. Run-failure email was straightforward to wire in for real — it fires synchronously inside the Playground run-failure path, reusing the existing SMTP `email_service.py`. A weekly summary requires something to run on a schedule (a Monday-morning cron job), and this codebase has no scheduler, task queue, or background-job runner of any kind — only synchronous request-time SMTP calls.

**Decision**: Ship `notify_weekly_summary` as a real, persisted user preference (`users.notify_weekly_summary`, toggleable in Settings) without building the delivery mechanism. The Settings UI shows an explicit caveat next to the toggle stating the email isn't sent yet, rather than silently implying it works.

**Rationale**: Building a bespoke scheduler for one email is a disproportionate amount of new infrastructure for this pass. Storing the preference now means no data migration is needed later, and the honest UI caveat avoids the worse outcome of a user believing they've opted into an email that will never arrive.

**Consequences**: `product/BACKLOG.md` carries a follow-up item ("Weekly Summary Email Delivery") proposing a cron script analogous to the existing `scripts/backup_sqlite.py`. Until that ships, `notify_weekly_summary=true` has no observable effect beyond the stored flag.

**Source**: `backend/app/models/user.py` (migration 011), `frontend/src/app/(app)/settings/page.tsx`, `product/BACKLOG.md`

---

## Folders and Tags Are Columns on `prompts`, Not Relational Tables

**Status**: Accepted

**Context**: The mockup shows folder and tag labels on prompt cards throughout the Dashboard and Library, but no folder/tag *management* UI (no "create folder," no tag color-coding, no tag merge/rename tooling). The existing `fields` column already established a precedent: dynamic, user-defined structure stored as JSON rather than a fully normalized schema.

**Decision**: `folder` is a plain nullable `VARCHAR` column on `prompts`; `tags` is a JSON list column, mirroring `fields`. Distinct-value listing (`GET /api/prompts/tags`, `GET /api/prompts/folders`) is computed in Python at request time rather than via a join to a dedicated table.

**Rationale**: The mockup only ever needed labels for display and filtering, not a managed taxonomy. A relational `folders`/`tags` table with foreign keys would add migration and query complexity (joins, cascade rules, rename propagation) the product doesn't need yet, and would contradict the "keep diffs minimal" convention already established by the `fields` column.

**Consequences**: Renaming a tag means updating it on every prompt that has it (no single source of truth to edit once) — acceptable at today's scale. If tag/folder management screens or cross-tag analytics become valuable, `product/ROADMAP.md` carries a follow-up to promote these to relational tables.

**Source**: `backend/app/models/prompt.py` (migrations 006, 008), `backend/app/api/routes.py`

---

## Editor Variables Panel Has No Persisted Type or Description

**Status**: Superseded 2026-07-12 — see "Real Per-Variable Type and Description" below

**Context**: The mockup's Editor "Variables" panel shows a name, a type badge, and a description per detected `{{variable}}`. This codebase has no type-validation system anywhere (Playground substitutes variables as plain strings), and adding persisted per-variable metadata would require a new schema field keyed by variable name.

**Decision**: Variable *names* are real — auto-derived live from the template via the existing `lib/placeholders.ts` parser (already used elsewhere for variable substitution). *Type* is a static, non-enforced "text" label shown for visual parity with the mockup. *Description* was not built at all — no input, no persistence.

**Rationale**: Building fake-looking type validation or a description field that silently didn't save anywhere would be worse than omitting it — a control that looks functional but does nothing is a trap for users. Since names are already real and derived live, that's the genuinely useful part of the panel; the rest was left as backlog rather than faked.

**Consequences**: `product/BACKLOG.md` carries a follow-up item ("Per-Variable Descriptions in the Editor") proposing a `variable_metadata` JSON column keyed by variable name.

**Source**: `frontend/src/components/EditorDetail.tsx`, `frontend/src/lib/placeholders.ts`, `product/BACKLOG.md`

---

## Real Per-Prompt Run Counts

**Status**: Accepted

**Context**: Library cards and the Editor's Usage card shipped 2026-07-12 with a hardcoded `—` in place of a per-prompt Playground run count, explicitly deferred as "a later phase" once run data existed. `playground_runs` rows have existed since migration 010, and the Dashboard's "top prompts by usage" already aggregated them — only the per-prompt display elsewhere was unwired.

**Decision**: Compute real counts via a grouped `playground_runs` query (`AnalyticsService.run_counts_by_prompt_ids`) and attach `run_count` as a field on `PromptHistoryResponse`, set on every route that returns a prompt (`/saved`, `/history`, `/{id}`, PATCH, restore).

**Rationale**: The route handlers already return raw SQLAlchemy `Prompt` instances relying on `response_model` + `from_attributes=True` for conversion (not explicit Pydantic construction), so attaching a plain non-mapped `run_count` attribute before return is consistent with the codebase's existing pattern, not a new one.

**Consequences**: Any future route that returns a `PromptHistoryResponse` must remember to attach `run_count` (defaults to `0` if omitted, so nothing breaks, but the figure would silently read zero instead of real).

**Source**: `backend/app/services/analytics_service.py`, `backend/app/api/routes.py`, `frontend/src/app/(app)/library/page.tsx`, `frontend/src/components/EditorDetail.tsx`

---

## Weekly-Summary Email Delivery via Cron-Invoked Script

**Status**: Accepted — supersedes "Weekly-Summary Notification Is Stored, Not Sent"

**Context**: The `notify_weekly_summary` preference (shipped 2026-07-12) was deliberately left unimplemented because this codebase has no scheduler, task queue, or background-job runner — only synchronous request-time SMTP calls. `product/BACKLOG.md` proposed "a cron-driven script (analogous to `scripts/backup_sqlite.py`) that runs weekly, aggregates each opted-in user's usage from `AnalyticsService`, and sends via a new `send_weekly_summary_email`."

**Decision**: Build the script largely as proposed, with one deviation from the `backup_sqlite.py` analogy: it lives in a new `backend/scripts/` package (not the root-level `scripts/`), because it needs the full installed `app` package (models, DB session, email service) — unlike `backup_sqlite.py`/`restore_sqlite.py`, which are deliberately dependency-free so they can run in a bare `python:3.12-slim` container. Scheduling reuses the already-running `backend` container via `docker compose exec backend python -m scripts.send_weekly_summary_email` (wrapped as `make send-weekly-summary`), rather than standing up a new sidecar image or Compose service purely to sleep-loop for a week. Note the `-m` module form is required, not a plain file path — the container's `app` package is only importable when the invoked script's own directory resolves to `/app` (as `run.py` does); a script under `/app/scripts/` needs `-m` so Python adds the working directory (`/app`) to `sys.path` instead of the script's own subdirectory.

**Rationale**: A `backend`-package-dependent script cannot run in the generic `python:3.12-slim` image the existing backup sidecar pattern uses without installing `app` into that image — duplicating the backend's dependency footprint into a second container for a once-a-week job is disproportionate. Executing inside the already-running, already-dependency-complete `backend` container via `docker compose exec` is simpler and has no new operational surface (no new image to build, version, or keep in sync).

**Consequences**: The weekly send is not visible in `docker compose ps` as its own service — it's an on-demand `exec`, so monitoring/alerting on it must watch host-crontab log output (`docs/deployment.md` documents `>> /var/log/prompt-maker-weekly-summary.log`) rather than container health. If a future job needs sub-daily scheduling or retry/backoff semantics, this ad hoc `cron` + `exec` approach should be revisited in favor of a real task queue.

**Source**: `backend/scripts/send_weekly_summary_email.py`, `backend/app/services/analytics_service.py` (`weekly_digest`), `backend/app/services/email_service.py` (`send_weekly_summary_email`), `Makefile`, `docs/deployment.md`

---

## Real Per-Variable Type and Description

**Status**: Accepted — supersedes "Editor Variables Panel Has No Persisted Type or Description"

**Context**: The Variables panel's type badge (shipped 2026-07-12) was a static, non-enforced `"text"` label with no persisted description, deliberately left that way rather than building "fake-looking type validation ... a trap for users." `product/BACKLOG.md` proposed a `variable_metadata` JSON column for description only; this pass extended the scope to also make *type* real, since type was the other half of the original gap.

**Decision**: Add `prompts.variable_metadata` (migration 012) — a JSON object keyed by variable name, each entry `{type: "text"|"number"|"boolean"|"list", description}`. The Editor's Variables panel gets a real, persisted type `<Select>` and description `<Input>` per detected `{{variable}}`. The Playground now renders a type-appropriate input control (`type="number"` input, a `Toggle` for boolean, `Textarea` for text/list) instead of always a generic textarea — this is what makes the type meaningfully real rather than cosmetic.

**Rationale**: A native `type="number"` input already guarantees its value is numeric-or-empty at the DOM level (browsers reject non-numeric keystrokes), so an initial pass adding a client-side "is this a valid number" check on top of it was redundant — jsdom-based testing confirmed the invalid-value code path was unreachable through normal typing, so it was removed rather than kept as untestable, effectively-dead validation. The type-appropriate *input control* itself is the real, observable behavior change; no additional enforcement was layered on.

**Consequences**: Variable substitution (`compile_prompt` on the backend, `compilePrompt` in `lib/placeholders.ts` on the frontend) still treats every value as a plain string regardless of declared type — `variable_metadata` changes what control is shown and what gets persisted as documentation, not the substitution mechanism. `[Insert ...]`-style placeholders (the other branch of `extractPromptPlaceholders`) can also receive type/description like any `{{var}}` row; no special-casing was added to exclude them.

**Source**: `backend/app/database/migrations.py` (012), `backend/app/models/prompt.py`, `backend/app/models/schemas.py` (`VariableMetadataItem`), `frontend/src/components/EditorDetail.tsx`, `frontend/src/components/PlaygroundView.tsx`

---

## Persist Evaluation Runs with Version Context and Denormalized Results — Migration 014

**Status**: Accepted

**Context**: Repeatable prompt evaluation needs to remain understandable after a test case is edited or deleted. It also needs to distinguish an automatic substring check, an AI-judged rubric, and a result that only a person can rate.

**Decision**: Store per-prompt eval cases with one of three scoring methods (`rule`, `judge`, `manual`). Each eval run records the current prompt version number, while each result copies the case method and label, stores the model output, and keeps only a nullable reference to the originating case. Manual results remain pending until a 1–5 star rating is submitted.

**Rationale**: Denormalizing the descriptive result fields preserves meaningful history even when the live eval set changes. Version context makes scores traceable to the prompt state under test. The three methods provide deterministic checks, flexible rubric-based grading, and human judgment without pretending they are equivalent.

**Consequences**: Rule scoring was initially limited to comma-separated substring presence (extended 2026-07-18 with prefix operators — see "Rule Criteria Operators as In-String Prefix Syntax" below). Judge scoring uses a fixed rubric prompt and pinned model, while the prompt-output run for each case uses the user's supported default model or the first available model. Custom judges and multi-model comparisons remain backlog items.

**Source**: `backend/app/models/eval_case.py`, `backend/app/models/eval_run.py`, `backend/app/models/eval_run_result.py`, `backend/app/services/eval_service.py`, `backend/migrations/014_create_eval_tables.sql`

---

## Eval Run Reproducibility Metadata — Migration 015

**Status**: Accepted

**Context**: `EvalRun` (migration 014) recorded only the prompt version and aggregate score. `EvalService.run_evaluation` already calls the billed `PlaygroundService` per case and a separate Judge grading call, and reads back latency/tokens/cost/model each time — but discarded all of it except `output_text`. Without it, a user comparing two eval runs of the same prompt version can't tell whether a score moved because the prompt changed or because the resolved model, a case's criteria, or the Judge model drifted between runs.

**Decision**: `EvalRun` gains `model` (the resolved execution model, shared across every case in the run) and aggregated `total_latency_ms`/`total_prompt_tokens`/`total_completion_tokens`/`total_cost_usd`, summed across every case run plus every Judge grading call. `EvalRunResult` gains a snapshot of the originating case's `criteria`/`variables` and, for Judge-method cases, the `judge_model` actually used — independent of the live `EvalCase`, which may be edited or deleted later.

**Rationale**: Aggregating on `EvalRun` rather than adding per-case cost/latency columns to `EvalRunResult` matches what the backlog actually asked for (run-level reproducibility and cost visibility) without doubling the columns added to the higher-cardinality results table. Snapshotting criteria/variables/judge model on the result — the same denormalization pattern migration 014 already used for `method`/`label` — keeps historical runs meaningful after a case edit, consistent with that migration's rationale.

**Consequences**: A single eval run's own cost isn't reflected in `playground_runs.cost_usd` (only the per-case `PlaygroundService.run` calls are — the Judge grading call never was and still isn't persisted to that table), so `AnalyticsService`'s Dashboard cost figures and the new budget ceiling in `product/DECISIONS.md`'s budget entry did not include eval-run cost until the unified `billed_calls` ledger (2026-07-18) began recording every billed call path. Custom Judge system-prompt/model overrides remain a separate backlog item ("Custom Eval Judges"); this migration only snapshots whichever judge model is currently hardcoded.

**Source**: `backend/app/database/migrations.py` (015), `backend/app/models/eval_run.py`, `backend/app/models/eval_run_result.py`, `backend/app/services/eval_service.py`, `frontend/src/components/editor/EvaluateTab.tsx`

---

## API Spend Budgets Enforced Against Historical Playground Cost, Server-Controlled Only

**Status**: Accepted

**Context**: Every user shares the one operator `OPENAI_API_KEY` (see "Playground Uses the Operator's OpenAI Key" above). Per-route rate limits (10/min Playground, 10/min eval runs, 10-20/min refine) bound request *frequency* but not spend — a single eval run can already fan out to 20 case calls plus 20 Judge calls, and nothing capped cumulative dollar spend.

**Decision**: Two optional operator env vars, `GLOBAL_MONTHLY_BUDGET_USD` and `USER_MONTHLY_BUDGET_USD`, each unset by default (meaning unlimited). `BudgetService.check()` sums `playground_runs.cost_usd` since the start of the current calendar month (global, and separately per calling user) and raises before any billed OpenAI call — Playground run, each eval case run, each Judge call, eval-case generation, and both refine endpoints — if either ceiling has already been reached. Rejections return HTTP 402, mirroring the existing "OpenAI quota exceeded" convention for `RateLimitError`. The (then-unauthenticated) `GET /api/prompts/config` reports only the *global* ceiling's exhausted/remaining state; the Playground and Evaluate UIs use that to proactively disable their run actions with a notice, the same pattern already used for the AI capability flag. *(That endpoint became authenticated and per-user in 2026-07-26's bring-your-own-provider change; the global budget snapshot it carries is unchanged.)*

**Rationale**: Reusing `playground_runs.cost_usd` — the same ledger `AnalyticsService` already aggregates for the Dashboard — avoids a second cost-tracking mechanism. Checking immediately before every billed call ensures all AI paths honor a ceiling that has already been reached according to that ledger. Env-var-only configuration keeps budgets server-controlled, consistent with the Icebox decision against per-user BYO keys — a threshold is an operator cost-control lever, not a user-editable setting.

**Consequences**: The ceiling is not a comprehensive measure of all OpenAI spend. Eval-case execution, Judge grading, eval-case generation, and refinement calls do not write their cost to `playground_runs`, so they are checked against the recorded Playground total but do not move that total themselves. A large evaluation therefore cannot trigger the ceiling mid-run based on its own spend. *(Resolved 2026-07-18: the unified `billed_calls` ledger — see the spend-ledger decision below — now records every billed call path, and `BudgetService` reads it.)* Monthly windows are fixed (calendar month, UTC) with no admin UI to reset or adjust mid-cycle.

**Source**: `backend/app/services/budget_service.py`, `backend/app/api/routes.py`, `backend/app/api/eval_routes.py`, `backend/app/api/refine_routes.py`, `backend/app/models/schemas.py` (`PromptsConfigResponse`), `frontend/src/components/PlaygroundView.tsx`, `frontend/src/components/editor/EvaluateTab.tsx`

---

## AI-Generated Eval Cases Are Reviewable Proposals, Not Writes

**Status**: Accepted

**Context**: AI assistance can reduce the effort of building an eval set, but generated cases may contain unsuitable variables, weak criteria, or an inappropriate scoring method. Persisting them immediately would silently alter the user's test suite and could consume the prompt's 20-case allowance with low-quality cases.

**Decision**: `POST /api/prompts/{id}/eval/cases/generate` returns up to 10 structured proposals derived from the current template, variable metadata, and an optional testing goal. The endpoint does not write `EvalCase` rows. The Evaluate tab exposes each proposal's method, criteria, and variables for editing, and only an explicit Accept action persists it through the existing create-case endpoint; Reject discards it client-side.

**Rationale**: Review-before-save keeps the user in control while reusing the existing ownership, validation, ordering, and case-limit behavior of normal case creation. It also avoids creating a second bulk-write path with different persistence semantics.

**Consequences**: Unsaved proposals disappear on navigation or reload. Generation is a billed, budget-checked OpenAI call and is rate-limited to 10/minute. The backend caps proposals to the remaining capacity under the 20-case limit, but accepted cases can still require user refinement before they are useful quality gates.

**Source**: `backend/app/api/eval_routes.py`, `backend/app/services/eval_generator_service.py`, `backend/app/models/schemas.py`, `frontend/src/components/editor/EvaluateTab.tsx`

---

## Prompt Preflight Is Deterministic, Advisory, and Shared in the Frontend

**Status**: Accepted

**Context**: Users can copy or execute templates containing unresolved placeholders, unbalanced XML, empty sections, stale variable metadata, or unusually large content. Some of those conditions may be intentional, and turning every warning into a backend validation error would break existing prompt workflows.

**Decision**: Implement preflight as deterministic frontend checks shared by the copy output, Playground, and Evaluate entry points. Findings are displayed through one reusable panel and never block the underlying action. The checks do not call OpenAI and do not change backend request schemas or compilation behavior.

**Rationale**: A shared pure function gives immediate, cost-free feedback and consistent wording at every execution boundary. Advisory severity preserves backward compatibility and lets advanced users proceed when a warning is intentional.

**Consequences**: API clients do not receive preflight feedback, and direct backend calls can still submit templates that the UI would warn about. The checks identify structural risks, not semantic prompt quality, and must remain synchronized with placeholder parsing and supported template conventions.

**Source**: `frontend/src/lib/preflight.ts`, `frontend/src/components/ui/PreflightPanel.tsx`, `frontend/src/components/OutputPanel.tsx`, `frontend/src/components/PlaygroundView.tsx`, `frontend/src/components/editor/EvaluateTab.tsx`

---

## Rule Criteria Operators as In-String Prefix Syntax, Not Structured Assertion Config

**Status**: Accepted

**Context**: Rule-method eval criteria were interpreted only as a comma-separated list of required substrings — unable to express “must not contain”, pattern matches, or “output must be valid JSON”. The backlog proposal (“Rich Deterministic Eval Assertions”) suggested explicit assertion types with structured configuration; that would have meant a new criteria schema, a migration for existing `EvalCase` rows, and a richer criteria-builder UI.

**Decision**: Extend the existing free-text `criteria` string with prefix operators instead: `!term` (not-contains), `~pattern` (regex), and `{json}` (output parses as valid JSON); everything else remains a plain contains-substring term. Splitting became bracket-aware (`()`, `[]`, `{}`) and backslash-escapable so regexes like `~\d{2,3}` survive as one term, while plain comma-separated criteria tokenize exactly as before. Operators are documented in the UI placeholder, the API schema description, and model comments.

**Rationale**: In-string operators are fully backward compatible — every existing case keeps its meaning with no migration and no schema change — and reuse the entire existing criteria pipeline (persistence, CSV import/export, run-result snapshots, the AI eval-case generator). A structured assertion config remains the right shape if JSON-path value checks or numeric-range assertions are added later, but was disproportionate for the three operators that cover most deterministic needs.

**Consequences**: A literal leading `!` or `~` in a wanted substring now needs awareness of the operator syntax (unprefixed terms starting with those characters are interpreted as operators). CSV-imported criteria get operator semantics automatically. The unshipped tail (JSON-path value checks, numeric ranges) is tracked in `product/BACKLOG.md` as the remaining scope of “Rich Deterministic Eval Assertions”.

**Source**: `backend/app/services/eval_service.py` (`_split_criteria`, `_score_rule`), `backend/app/models/schemas.py`, `frontend/src/components/editor/EvaluateTab.tsx`

---

## Judge Grading Returns Structured Feedback and Sees the Compiled Prompt, with Per-Case Failure Capture

**Status**: Accepted

**Context**: The Judge eval method originally returned an opaque free-text rationale, graded the model output *without* seeing the prompt that produced it, and any judge-side failure (API error or an unparseable response) could abort the entire eval run — discarding results for cases that had already completed successfully.

**Decision**: The judge call now uses a strict JSON schema response — integer `score`, `strengths` list, `weaknesses` list, and a short `rationale` — stored as JSON in the existing rationale field and rendered by a dedicated `JudgeRationale` component. The grading request includes the compiled prompt as context, char-capped (6k prompt / 12k output) so a pathological case can’t blow up judge token spend. Judge response parse failures raise `JudgeError` and are captured per-case exactly like judge API errors; OpenAI client construction failures in `PlaygroundService.run` wrap into `PlaygroundRunError` instead of escaping as a 502.

**Rationale**: A judge that can’t see the prompt is grading against the rubric alone — showing it the compiled prompt materially improves grading relevance at bounded token cost. Structured strengths/weaknesses make a low score actionable rather than a bare number. Per-case failure capture preserves the paid-for results of every case that did complete, consistent with how case-run errors were already handled.

**Consequences**: Historical judge rationales stored as plain text still render (the UI falls back to raw text when the rationale isn’t parseable JSON). The char caps mean a very large compiled prompt is truncated in the judge’s view — noted with an explicit truncation marker. The judge rubric and model remain hardcoded; user-configurable judges stay a backlog item (“Custom Eval Judges”).

**Source**: `backend/app/services/eval_service.py`, `backend/app/services/playground_service.py`, `frontend/src/components/editor/EvaluateTab.tsx`

---

## Unified AI Spend Ledger (`billed_calls`) with No Backfill — Migration 016

**Status**: Accepted

**Context**: Budget ceilings and the Dashboard spend figure summed only `playground_runs.cost_usd`, while eval case runs, Judge grading, eval-case generation, refinement, and AI parse billed the shared operator key without recording their cost anywhere the budget could see. The budget decision above explicitly flagged the gap: a large evaluation could not trip the ceiling on its own spend.

**Decision**: A `billed_calls` table (migration 016: `user_id`, `source` discriminator, `model`, token counts, `cost_usd`, `created_at`) is written by every billed OpenAI call path via `spend_ledger.record_billed_call()`, which computes cost from the shared `PRICING` table and deliberately does not commit — the caller owns the transaction, so an eval run's many ledger rows ride its single end-of-run commit. `BudgetService` and the Dashboard's total-spend figure now read `billed_calls`; average cost-per-run stays on `playground_runs` (it is per-Playground-run by definition). The previously uncovered parse-text endpoint also gained a budget check. Existing `playground_runs` rows are not backfilled.

**Rationale**: One append-only ledger answering "what did we spend" is simpler and more complete than teaching the budget to union several feature tables. Skipping backfill keeps the query trivial and avoids any double-counting risk; the cost is that month-to-date budget visibility resets once at deploy — in the user's favor, on an opt-in feature.

**Consequences**: The refiner, parser, and eval-generator services now return `(result, usage)` tuples so their routes can record spend (they previously discarded `response.usage` entirely). `playground_runs.cost_usd` continues to exist for run history and per-run analytics but is no longer the budget's source of truth. The Dashboard's "Total cost" card was relabeled "Total AI spend" since it now includes eval/refine/parse usage and diverges from cost-per-run × runs.

**Source**: `backend/app/models/billed_call.py`, `backend/app/services/spend_ledger.py`, `backend/app/services/budget_service.py`, `backend/app/database/migrations.py`

---

## Eval Runs Fan Out on a Thread Pool with One Batch Budget Pre-Check

**Status**: Accepted

**Context**: `EvalService.run_evaluation` executed up to 20 cases strictly sequentially inside one synchronous HTTP request — a Judge-heavy set meant up to 40 back-to-back OpenAI calls, risking Caddy/browser timeouts that would waste the whole run's billed spend. This was the final unresolved finding from the pre-launch evaluation and refinement audit. The judge's OpenAI client also had no timeout at all (SDK default ~10 minutes).

**Decision**: Case execution fans out across a `ThreadPoolExecutor` (5 workers) of pure functions that touch no SQLAlchemy session or ORM object; all persistence stays on the request thread, collecting futures in submission order so results persist in case order with unchanged semantics and still one end-of-run commit. Each case future gets a 90-second ceiling that records a normal failure row ("timed out") instead of hanging the request, and the judge client gains the same 30s timeout as the Playground client. The per-billed-call `BudgetService.check` calls became one batch pre-check before dispatch. Threads were chosen over asyncio because the whole call chain (sync route handler, sync OpenAI SDK usage) is synchronous today — an async conversion would be a much larger, riskier change for the same latency win.

**Rationale**: Parallelism cuts a worst-case run from ~40 sequential calls to ~8 waves of 5, comfortably inside proxy timeouts, without introducing the persistent-job machinery that the backlog's progress/cancellation item will eventually need. Keeping workers session-free sidesteps SQLAlchemy/SQLite thread-safety entirely.

**Consequences**: A ceiling crossed mid-run no longer halts remaining cases — bounded by the 20-case cap, and the run's own ledger rows (see the spend-ledger decision above) block the next billed call. Tests that rely on sequential mock call order pin `max_workers=1`. The run remains a single synchronous request; per-case progress and cancellation stay on the backlog.

**Source**: `backend/app/services/eval_service.py`, `backend/tests/test_eval_service.py`

---

## Monotonic Prompt IDs on SQLite — Migration 018

**Status**: Accepted

**Context**: SQLite can reuse the highest deleted `INTEGER PRIMARY KEY`. Prompt IDs appear in durable Editor and Playground URLs, so reuse could make an old URL resolve to an unrelated prompt.

**Decision**: Keep a single-row `prompt_id_sequence` high-water mark and explicitly allocate IDs for every application prompt-creation path on SQLite. PostgreSQL keeps its native sequence behavior.

**Rationale**: A small allocator avoids a destructive rebuild of the heavily referenced `prompts` table solely to add SQLite's `AUTOINCREMENT` keyword. Each allocation also reconciles against the live maximum, so direct maintenance inserts cannot move the allocator backward.

**Consequences**: Deleted prompt IDs remain gaps permanently. New prompt-creation paths must call `PromptIdService.next_id`; direct model inserts in tests may still use SQLite defaults because the allocator reconciles before its next application allocation.

**Source**: `backend/app/services/prompt_id_service.py`, `backend/app/database/migrations.py` (018), `backend/app/api/routes.py`

---

## Explicit Eval-Case Names and Intentionally-Empty Semantics — Migration 017

**Status**: Accepted

**Context**: Positional case labels made run history hard to scan, while robustness cases with deliberately blank variables triggered a permanent preflight warning indistinguishable from incomplete setup.

**Decision**: Eval cases persist an optional `name` and an `intentionally_empty` boolean. Names become the run-result label when present. The missing-variable preflight warning excludes only cases explicitly marked intentionally empty; generated proposals with blank inputs start with that marker selected for review.

**Rationale**: Persisted intent survives reloads, duplication, and CSV round trips without weakening the advisory preflight check for ordinary incomplete cases.

**Consequences**: CSV exports include `name` and `intentionally_empty` metadata columns after the required `method,criteria` prefix. Older imports remain valid.

**Source**: `backend/app/models/eval_case.py`, `backend/app/api/eval_routes.py`, `frontend/src/components/editor/EvaluateTab.tsx`

---

## Prompt Field Content Is Not HTML/XML-Entity-Escaped

**Status**: Accepted — reverses the escaping introduced for "Blocker #2" in an earlier audit

**Context**: `PromptGeneratorService.generate` originally embedded field content as-is; an earlier pre-launch audit flagged that unescaped `<`, `>`, `&` produced a generated block that wouldn't parse as strict XML (`xml.etree.ElementTree`), and the fix was to run content through `xml.sax.saxutils.escape`. A later independent audit (2026-07-19) flagged the opposite problem: that escaping is applied at the generation source, so the escaped `&lt;b&gt;` form is what gets persisted, shown in the Compiled view, copied to the clipboard, and emitted in the Export Code snippets — a user who types `<b>html</b>` or `cars & trucks` gets a corrupted artifact back everywhere they read or reuse their own prompt.

**Decision**: Removed the `escape()` call. Field content now passes through `generate()` byte-for-byte; only the field-name-derived `<TAG>` wrapper is real markup.

**Rationale**: Nothing in this app parses the generated prompt as strict XML at runtime — the `<GOAL>`/`<AUDIENCE>`-style tags are a convention for the LLM reading the prompt (the same pattern Claude's own docs recommend), not machine-parsed structure. The one caller that ever did (`ElementTree.fromstring`) was a test asserting well-formedness for its own sake, not a real consumer. `frontend/src/lib/preflight.ts`'s "unbalanced XML tags" check is advisory-only and never blocks (see the Preflight Checks decision above), so it tolerates content that includes stray `<`/`>`/`&`. Given that, content-fidelity through save/compile/copy/export is the correct thing to guarantee, not strict XML well-formedness.

**Consequences**: A field value containing a bare `</TAG>`-shaped line can visually confuse the syntax-highlighted code view's block grouping (`frontend/src/components/OutputPanel.tsx`) — cosmetic only, since React renders it as text, not parsed markup. If a future feature needs to machine-parse the generated prompt as real XML, it will need its own escaping at that boundary, not a reintroduction of escaping at generation time.

**Source**: `backend/app/services/prompt_generator.py`, `backend/tests/test_prompt_generator.py`

---

## npm audit Gates on Production Dependencies Only

**Status**: Accepted

**Context**: `make security-frontend` and CI's frontend job both failed on advisories that had no non-breaking remedy. `next`, `postcss`, and `sharp` were genuinely fixable (bumping `next` to 16.2.11 plus a `sharp: ">=0.35.0"` override), but nine remaining high-severity findings all traced to one package: `brace-expansion` (DoS, fixed only in 5.0.8), reached through `minimatch@3`, which `eslint-plugin-import@2.32.0` — the latest release, pulled in by `eslint-config-next` — still pins. Forcing `brace-expansion >=5.0.8` globally breaks ESLint outright (`minimatch@3` does `require('brace-expansion')` and calls it; v5's CJS build exports an object → "expand is not a function"). `npm audit fix --force` "fixes" it by downgrading `@eslint/eslintrc` to 0.1.0.

**Decision**: The gating audit runs `npm audit --omit=dev --audit-level=moderate`. The full-tree audit still runs immediately before it, unfiltered, but non-blocking.

**Rationale**: `devDependencies` exist only in the discarded builder stage — the runtime image installs with `npm ci --omit=dev` (`frontend/Dockerfile:27`) — so a lint-time DoS in `brace-expansion` has no production attack surface. The alternatives were to downgrade the lint toolchain, pin a broken override, or disable the audit gate entirely — all worse. Production dependencies still fail the build on any moderate-or-higher advisory.

**Consequences**: A vulnerability that only reaches `devDependencies` no longer breaks the build; it is printed in the CI log and must be triaged by reading that output rather than by a red job. If the dev-tool advisory backlog ever needs enforcement, the gate is one flag away from full-tree again.

**Source**: `Makefile` (`security-frontend`), `.github/workflows/ci.yml` (frontend-quality → Security audit), `frontend/package.json` (`overrides`)

---

## Uniform 30-Second Timeout for OpenAI Requests

**Status**: Amended by "Bring-Your-Own LLM Provider over an OpenAI-Compatible Transport" (below) — 30s remains the default for *hosted* providers; self-hosted ones default to 180s

**Context**: AI import, Playground execution, eval output generation and Judge grading, eval-case generation, and both refinement stages all run synchronously inside user-triggered HTTP requests. Some clients already set a 30-second timeout, while others inherited the OpenAI SDK's much longer default and could leave the UI waiting well beyond the reverse proxy's practical request window.

**Decision**: Construct every OpenAI client with `timeout=30.0`. Keep evaluation's separate 90-second per-case future ceiling because one case may make both an output-generation call and a Judge call.

**Rationale**: A consistent upstream bound gives every billed AI feature predictable failure behavior, avoids multi-minute hung requests, and aligns service behavior with the Playground and proxy timeouts already used in production.

**Consequences**: A slow upstream response now fails the affected feature instead of waiting for the SDK default. There is no automatic retry, so callers receive the feature's existing error state and can retry explicitly. Evaluation continues to capture per-case Judge failures without aborting the whole run; other features return their established route-level failure responses.

**Source**: `backend/app/services/prompt_parser.py`, `backend/app/services/playground_service.py`, `backend/app/services/eval_service.py`, `backend/app/services/eval_generator_service.py`, `backend/app/services/prompt_refiner.py`

---

## Bring-Your-Own LLM Provider over an OpenAI-Compatible Transport

**Status**: Accepted

**Context**: Every AI feature — AI import, Refine questions/draft, the Playground, eval case runs, judge grading, eval-case generation — constructed its own `OpenAI(api_key=os.getenv("OPENAI_API_KEY"))` client at five separate call sites. That hard-wired the product to OpenAI and made the operator the payer for every user's usage. It blocked self-hosting (an Ollama or vLLM server on the operator's own hardware could not be used at all), blocked anyone without an OpenAI account, and made opening registration a direct financial liability. It also reversed two prior positions: the "Playground Uses the Operator's OpenAI Key" decision above, and the `product/BACKLOG.md` Icebox entry "Per-user BYO OpenAI keys", both of which deferred this work on the grounds that per-user credential storage was a materially larger, security-sensitive feature. It is — that judgment was correct; the tradeoff simply changed once portability and self-hosting became the goal.

**Decision**:

1. **Bring-your-own only.** Each user configures a provider connection in Settings → API access: a provider handle from a known registry (`openai`, `anthropic`, `gemini`, `ollama`, `vllm`, `custom`), an optional base-URL override, an API key, and a free-text model name. There is no operator fallback key; `OPENAI_API_KEY` is gone from the backend and from `docker-compose.yml`.
2. **OpenAI-compatible transport, not native SDKs.** Every provider is reached through its OpenAI-compatible chat-completions endpoint using the existing `openai` SDK with a per-provider `base_url`. No `anthropic` or `google-genai` dependency is added.
3. **One construction site.** `backend/app/services/llm_client.py` is the only place `OpenAI(...)` is constructed. `client_for(user)` resolves the acting user's connection or raises a typed `LLMConnectionError`; the five services take an `LLMConnection` as an argument.
4. **Prompt-carried JSON schema.** Four services need machine-readable JSON back. `response_format` is *not* portable: Anthropic's compatibility layer documents it as **silently ignored** (so a "try strict, fall back on error" strategy would never trigger — it returns prose with a 200), Ollama honours only the coarse `{"type": "json_object"}` form, and an arbitrary gateway may reject it outright. So `json_completion()` always puts the JSON Schema in the system prompt, layers `response_format` on top only where the provider registry says it helps, parses tolerantly (code fences, surrounding prose), and retries once at a lower capability rung. Token usage from every attempt is billed, because every attempt was really spent.
5. **Pricing keyed by `(provider, model)`.** `services/llm_pricing.py` replaces the model-keyed table in `playground_service.py`; `billed_calls` gains a `provider` column. Self-hosted providers price at 0.0; unknown pairs still degrade to 0.0 rather than raising, preserving the previous behaviour.
6. **Credentials encrypted at rest.** `services/secret_store.py` wraps Fernet from the already-vendored `cryptography` package. Key material comes from `LLM_ENCRYPTION_KEY` when set, otherwise it is HKDF-derived from `SECRET_KEY` so existing deployments gain encryption without a new mandatory variable.
7. **`users.default_model` retired from the API.** The model now lives on the connection; a second, separately-validated model preference had no coherent meaning. The column remains (migration 019 backfills `llm_model` from it, and SQLite cannot drop a column without rebuilding the table) but is no longer read or exposed.

**Rationale**: The OpenAI-compatible `base_url` approach buys support for four vendor APIs plus any self-hosted server for roughly the cost of a provider registry, versus an adapter layer per native SDK. Putting the JSON contract in the prompt for *everyone*, rather than branching on capability, means the fragile path (a provider that ignores `response_format`) is the same code path that is exercised constantly by the providers that don't — no untested fallback. A single client-construction seam is what makes the "which provider did this call use" question answerable at all, and is what the per-user isolation test asserts against.

**Consequences**:

- **Existing users must re-enter a key.** Migration 019 pre-fills `llm_provider='openai'` and `llm_model` from their old `default_model`, so the Settings form opens already pointing at what they were implicitly using — but deliberately **without** a key. The operator's shared `OPENAI_API_KEY` is never copied into user rows: fanning one credential across N database rows is a worse outcome than a signposted empty state. Until a user adds a key, AI features show a "Connect a provider in Settings" notice rather than failing at call time.
- **Budget ceilings change meaning.** `GLOBAL_MONTHLY_BUDGET_USD` / `USER_MONTHLY_BUDGET_USD` no longer protect an operator wallet — the user pays their provider directly. They remain useful as usage guard rails (capping how much activity the app drives on anyone's behalf) and are documented as such. They never bind for a self-hosted connection, which prices at 0.0.
- **Output quality varies by provider.** The prompts were tuned against OpenAI models. A small local model may return JSON that fails both attempts; that surfaces as an actionable "try a more capable model" error rather than a 500.
- **Judge grading uses the user's own model.** There is no operator-pinned judge model to fall back on, so `_score_judge` reuses the case's connection. Scores are therefore not comparable across users with different providers.
- **Per-case eval timeout is derived, not fixed.** It is a multiple of the provider's per-request timeout (30s hosted, 180s self-hosted, overridable via `LLM_TIMEOUT_SECONDS`), because a 90s ceiling would fail nearly every self-hosted run.
- **Base URLs are user-supplied server-side request targets.** They are validated at the boundary (http/https only, real host, no embedded credentials, no query/fragment) but private and loopback addresses are deliberately *allowed* — that is the self-hosting case. The residual SSRF exposure is documented in `SECURITY.md`.
- **Key rotation.** Rotating `SECRET_KEY` (or `LLM_ENCRYPTION_KEY`) makes stored ciphertexts undecryptable. That surfaces as a typed `StoredKeyUnreadableError` and reaches the user as "re-enter your API key", never as a 500.

**Source**: `backend/app/services/llm_client.py`, `backend/app/services/llm_providers.py`, `backend/app/services/llm_pricing.py`, `backend/app/services/secret_store.py`, `backend/app/database/migrations.py` (019), `backend/app/api/auth_routes.py` (`/api/auth/me/llm-connection`), `backend/app/api/routes.py` (`GET /api/prompts/config`), `frontend/src/components/LLMConnectionForm.tsx`

---

## Rename to Prompt Maker Studio Keeps Backward-Compatible Shims

**Status**: Accepted

**Context**: The product was renamed from "Prompt Maker" to "Prompt Maker Studio". The name had no single definition — it was a literal in ~14 frontend files (six of which set `document.title` imperatively with their own reset string), three duplicated inline wordmarks, nine backend strings, and the `prompt-maker` slug in container names, image names, package names, the Grafana dashboard, browser storage keys, and the HKDF `info` used to derive the encryption key for stored per-user LLM credentials. Two of those are load-bearing in a way a text replacement does not survive: renaming the HKDF context makes every stored API key undecryptable, and renaming the storage namespace signs every user out and discards their unsaved drafts.

**Decision**:

1. **One source of truth per stack.** `frontend/src/lib/branding.ts` exports `APP_NAME`, `APP_SLUG`, `pageTitle()`, and `storageKey()`; `backend/app/branding.py` exports `APP_NAME`. No user-visible name literal remains outside those two files.
2. **One `Wordmark` component.** `frontend/src/components/ui/Wordmark.tsx` replaces the three duplicated copies and is rendered in the NavBar, so the name is visible on every authenticated page rather than only in the footer. The accent colour falls on the last word of `APP_NAME`, derived rather than hardcoded.
3. **Storage keys migrate, they don't break.** `migrateLegacyStorageKeys()` copies any `prompt-maker:*` entry to `prompt-maker-studio:*` and removes the original. It runs at import time in `lib/auth.ts`, not in an effect, because the app layout reads the token during render.
4. **Ciphertext falls back, then upgrades.** `secret_store.decrypt_secret()` retries the pre-rename HKDF derivation when the current one fails, and any subsequent write re-encrypts under the new one. The fallback is skipped when `LLM_ENCRYPTION_KEY` is set, since an explicit key is used verbatim and never went through HKDF.
5. **The Compose project name is pinned to `prompt-maker`.** Volume names derive from it, so the `prompt-maker_backend-data` volume holding the production database is unaffected by the rename — or by any future rename of the checkout directory.

**Rationale**: A rename is cosmetic by intent; letting it destroy user data or credentials would be a self-inflicted incident with no upside. Both shims are small, local, and self-limiting — each has a documented condition under which it can be deleted. Pinning the Compose project name is the cheapest possible insurance against the failure mode with the worst blast radius, and is a no-op today.

**Consequences**:

- Two compatibility paths now exist that will look like dead code to a future reader. Both carry comments naming the condition for removal: no active session predating the rename, and no ciphertext predating the rename.
- Published images move to `ghcr.io/<owner>/prompt-maker-studio-{backend,frontend}`. Deployments pinning the old image name must update `docker-compose.prod.yml` or their `IMAGE_TAG` source; the old tags are not republished.
- The Grafana dashboard UID changed, so bookmarked dashboard links break. Accepted — the dashboard is operator-facing and the provisioner recreates it on restart.
- The GitHub repository, the checkout directory, and the `prompt-maker_backend-data` volume keep the old slug. Documentation URLs and clone commands therefore still say `prompt-maker`, which is correct until the repository itself is renamed.

**Source**: `frontend/src/lib/branding.ts`, `frontend/src/components/ui/Wordmark.tsx`, `backend/app/branding.py`, `backend/app/services/secret_store.py`, `docker-compose.yml`

## Content-Security-Policy keeps `script-src 'unsafe-inline'`

**Decision.** The production CSP drops `'unsafe-eval'` but retains
`'unsafe-inline'` for `script-src`.

**Why.** A nonce is the correct fix and is what Next documents. It was
implemented and measured: Next serves its App Router flight data as roughly six
inline `<script>` blocks per document, and a nonce has to be minted per
response — but every page here is statically prerendered, so the prerendered HTML
cannot carry one. The result was a policy that parsed correctly, blocked the
app's own scripts, and left "Loading..." on screen. Build-time hashes are no
better: the inline contents differ per page and per build.

Closing this properly means opting the whole app into dynamic rendering. That is
a rendering-architecture change with a real cost, so it is recorded here as a
known exposure rather than made silently as part of a security fix.

**Consequences.** An injected script would still execute with the victim's
session, so XSS prevention in application code remains the primary control. The
exposure and its cause are stated in `SECURITY.md`, and `frontend/e2e/csp.spec.ts`
asserts the current policy — including a test that fails, on purpose, if
`'unsafe-inline'` is ever removed, so this entry gets revisited rather than
quietly outliving its reason.
