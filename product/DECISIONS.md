# Product & Architecture Decisions

Lightweight decision log (ADR-style). Records significant choices and their rationale to guide future development.

> Reviewed against the codebase: 2026-10-16 (published 0.5.1).
> This is a historical decision log. Superseded entries describe the behavior
> and source locations at the time; current amendments are stated explicitly.
> Use [FEATURES.md](FEATURES.md) and the [documentation index](../docs/README.md)
> for the current supported behavior.

---

## Dynamic JSONB Fields for Prompts — Migration 001

**Status**: Accepted

**Context**: The original schema used fixed columns for prompt fields. As the product evolved, the number and names of fields became user-defined, making a fixed-column schema unworkable.

**Decision**: Replace fixed prompt columns with a single `fields` JSONB column storing an array of `{name, content}` objects.

**Rationale**: A dynamic field model is the core product primitive — users define their own field names. JSONB (with SQLite JSON fallback) provides flexibility without requiring a schema migration per new field type. A Pydantic validator enforces uniqueness of field names at the application layer.

**Consequences**: Prompt fields cannot be queried individually at the database level without JSON path operators. Full-text search on field contents requires application-layer filtering or a dedicated search index.

**Source**: `backend/app/database/migrations/v001_dynamic_prompt_fields.py`, `backend/app/models/prompt.py` (the SQL file under `backend/migrations/` is historical reference only)

---

## User Ownership on Prompts — Migration 002

**Status**: Accepted

**Context**: Prompts initially had no owner. As authentication was added, all data needed to be scoped to the authenticated user.

**Decision**: Add a `user_id` foreign key to the `prompts` table; backfill existing rows to the oldest user; enforce NOT NULL going forward.

**Rationale**: User-scoped data is a security and privacy requirement. Ownership enforcement prevents users from reading or modifying each other's prompts. The backfill strategy (assign to oldest user) was chosen as a safe default for existing data during migration.

**Consequences**: Prompt data operations require an authenticated user. The shared ownership check in `backend/app/services/prompts/ownership.py` returns HTTP 404 for both missing prompts and prompts not owned by the requesting user. `GET /api/prompts/config` was originally an intentionally public capability check; it became authenticated when bring-your-own providers made capability state user-specific (see the superseding decision below).

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
removes token theft from the XSS blast radius. Lax permits ordinary navigation back to the app while limiting cross-site
credential attachment. The default deployment is same-origin through Caddy or
the Next.js proxy; a shared `COOKIE_DOMAIN` is optional for split-subdomain setups. Keeping the bearer path avoids breaking
scripts and CI, and costs nothing: nothing stores a readable token any more.

**Consequences**: HTTPS deployments use `COOKIE_SECURE=true`. `COOKIE_DOMAIN`
is optional for the default same-origin setup; split-subdomain deployments may
need a shared parent domain. Plain-HTTP environments (local dev, the E2E
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

**Decision**: Apply per-route rate limits using SlowAPI. Registration and login default to 5/min and 10/min (operator-overridable); parse-text is 20/min. Password, profile, refinement, Try once, evaluation, OAuth and diagnostic routes have their own limits. The old generate route was removed in 0.3.0; see [the API reference](../docs/api.md) and route decorators for current limits.

**Rationale**: SlowAPI integrates directly with FastAPI and provides decorator-based per-route limits with minimal overhead. The limits chosen reflect: tighter limits on auth endpoints (brute-force protection) and higher limits on operational endpoints (normal usage headroom).

**Consequences**: Legitimate users making bursts of AI requests can hit a feature limit. The limits should be tuned based on observed usage patterns. Behind Caddy in production, the client IP is extracted from forwarded headers — this must be correctly configured to avoid all requests appearing as the same IP.

**Source**: `backend/app/limiter.py`, `backend/app/api/routes.py`, `backend/app/api/auth_routes.py`

---

## SQLite as Primary Database

**Status**: Accepted — suitable for current scale

**Context**: The application needs a relational database with JSON support. PostgreSQL and SQLite were both options given the SQLAlchemy ORM in use.

**Decision**: Use SQLite as the primary database.

**Rationale**: SQLite requires no separate database service, simplifying local development and Docker deployment. The current user base and data volume do not require PostgreSQL's concurrency or replication features. SQLAlchemy provides a starting point for another database, but the custom migrations, SQLite maintenance scripts and concurrency behavior would require an explicit portability project.

**Consequences**: SQLite has limited concurrency (single writer). High concurrent write throughput will require a move to PostgreSQL. JSONB support in SQLite is handled via a compatibility shim in the model — behavior may differ subtly from native PostgreSQL JSONB.

**Source**: `backend/app/database/connection.py`, `backend/app/models/prompt.py`

---

## Lightweight Idempotent SQLite Database Migrations

**Status**: Accepted

**Context**: As new columns and constraints are added to SQLite database tables during active feature development, `SQLAlchemy.metadata.create_all()` is insufficient for upgrading existing databases. However, integrating full-blown migrations frameworks like Alembic adds significant operational complexity and overhead for a simple SQLite setup.

**Decision**: Implement a custom, lightweight, and idempotent migration runner (`backend/app/database/migrations/runner.py`) executed automatically at FastAPI startup.

**Rationale**: A lightweight runner written directly in Python maintains a minimal runtime and dependency footprint. Idempotent check functions (e.g. checking `PRAGMA table_info` and tracking applied schema versions in a `schema_migrations` table) ensure that migrations can be run repeatedly without causing errors or data loss, even if schema columns or indices are already present.

**Consequences**: The migration framework is tailored for SQLite only. Complex migrations (such as dropping columns or altering constraints in ways not natively supported by SQLite) require versioned migration steps that rebuild tables when needed. If the application is migrated to PostgreSQL in the future, migrations will need to be transitioned to a compatible system (e.g. Alembic).

**Source**: `backend/app/database/migrations/runner.py`, `backend/app/main.py`

---

## Force Re-login After Username Change

**Status**: Superseded (2026-10-15) — a rename now keeps the session; see the amendment below

**Context**: Users can change their username via `PATCH /api/auth/me`. The JWT token encodes `username` as the `sub` claim. After a username change, the existing token still references the old username, which no longer matches the stored user record — causing all subsequent authenticated requests to fail silently or with confusing 401 errors.

**Decision**: After a successful username change, the frontend explicitly calls `handleLogout()` to clear the token and redirect the user to the login screen.

**Rationale**: Forcing re-authentication is the safest and most transparent response to credential change. Silent continuation would leave the user with a broken session. Alternatives (token refresh, new token returned from the PATCH endpoint) were ruled out because the current architecture has no token refresh mechanism and returning a new token from a profile update endpoint is an unusual pattern that adds security surface.

**Consequences**: Every username change requires the user to log back in with their new username. This is a known friction point — users should be warned in the UI before confirming the change. The sliding-renewal endpoint added 2026-07-19 (`POST /api/auth/refresh`) does not change this: it re-issues a token for the *same* subject, and after a username change the old subject no longer matches the user record, so forced re-login remains the correct behavior. This decision would only need revisiting if tokens moved to a stable subject (e.g. user ID).

**Amendment — immutable token subjects**: Migration 026 replaces username subjects with unique account UUIDs. A renamed account keeps its identity, and a token cannot follow a username or numeric ID into another account. This initially retained frontend sign-out after a rename; the subsequent amendment below removes it. Username mismatch is no longer a server-side revocation mechanism. Existing username-subject tokens must authenticate again.

**Amendment — rename keeps the session (2026-10-15)**: With stable subjects the forced sign-out protected nothing, so Settings now updates the displayed username from the `PATCH` response and the session continues. Editor drafts are stored under username-keyed browser keys; drafts saved under the old name are no longer offered after a rename and are purged on the next explicit sign-out — previously the forced sign-out deleted them outright.

**Source**: `backend/app/api/account_routes.py`, `backend/app/schemas/accounts.py`, `frontend/src/features/settings/ProfileSettings.tsx`

---

## Explicit `updated_at` Assignment vs. SQLAlchemy `onupdate`

**Status**: Accepted

**Context**: The `updated_at` column on the `prompts` table must be set whenever a prompt is updated via `PATCH /api/prompts/{id}`. SQLAlchemy supports an `onupdate` hook on column definitions that fires automatically on ORM `UPDATE` operations.

**Decision**: Explicitly assign `updated_at` in the shared prompt mutation service before committing, rather than relying on `Column(..., onupdate=...)`. The current `next_write_stamp()` guarantees a timestamp greater than the prior stamp, including writes within one clock tick.

**Rationale**: SQLAlchemy's `onupdate` hook does not fire in all circumstances — specifically it is bypassed when `db.execute()` raw SQL is used, or when the ORM session bulk-updates without going through individual model instances. Explicit assignment at the service mutation boundary is predictable, visible, and testable. It also makes the intent clear to future maintainers.

**Consequences**: Any future code path that updates a prompt record must remember to set `updated_at` manually. If a bulk update pathway is added later, it must explicitly include the timestamp.

**Source**: `backend/app/services/prompts/library.py`, `backend/app/services/optimistic_concurrency.py`, `backend/app/models/prompt.py`

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

**Consequences**: Password change reissues a cookie for the calling browser with a new account token version and authentication time; every other session and linked MCP authorization is invalidated. Both password change and username rename keep the caller signed in, for different reasons. Tokens now identify immutable account UUIDs.

**Source**: `backend/app/api/account_routes.py`, `backend/app/schemas/accounts.py`, `backend/app/services/accounts/profile.py`

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

**Status**: Superseded 2026-10-11 — prompts are only saved through `POST /api/prompts` (also used by MCP); see "Sections Are the Only Thing Clients Write" below

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

**Status**: Superseded 2026-10-11 — the dashboard was retired; see "Retire Shallow and Misleading Features" below

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

**Status**: Accepted for folders; tags retired from the product 2026-10-11 — see "Folders Stay Labels; Tags Leave the Product" below

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

**Status**: Superseded 2026-10-11 — run counts were removed with the Playground; see "Retire Shallow and Misleading Features" below

**Context**: Library cards and the Editor's Usage card shipped 2026-07-12 with a hardcoded `—` in place of a per-prompt Playground run count, explicitly deferred as "a later phase" once run data existed. `playground_runs` rows have existed since migration 010, and the Dashboard's "top prompts by usage" already aggregated them — only the per-prompt display elsewhere was unwired.

**Decision**: Compute real counts via a grouped `playground_runs` query (`AnalyticsService.run_counts_by_prompt_ids`) and attach `run_count` as a field on `PromptHistoryResponse`, set on every route that returns a prompt (`/saved`, `/history`, `/{id}`, PATCH, restore).

**Rationale**: The route handlers already return raw SQLAlchemy `Prompt` instances relying on `response_model` + `from_attributes=True` for conversion (not explicit Pydantic construction), so attaching a plain non-mapped `run_count` attribute before return is consistent with the codebase's existing pattern, not a new one.

**Consequences**: Any future route that returns a `PromptHistoryResponse` must remember to attach `run_count` (defaults to `0` if omitted, so nothing breaks, but the figure would silently read zero instead of real).

**Source**: `backend/app/services/analytics_service.py`, `backend/app/api/routes.py`, `frontend/src/app/(app)/library/page.tsx`, `frontend/src/components/EditorDetail.tsx`

---

## Weekly-Summary Email Delivery via Cron-Invoked Script

**Status**: Superseded 2026-10-11 — all notification emails were removed; see "Retire Shallow and Misleading Features" below

**Context**: The `notify_weekly_summary` preference (shipped 2026-07-12) was deliberately left unimplemented because this codebase has no scheduler, task queue, or background-job runner — only synchronous request-time SMTP calls. `product/BACKLOG.md` proposed "a cron-driven script (analogous to `scripts/backup_sqlite.py`) that runs weekly, aggregates each opted-in user's usage from `AnalyticsService`, and sends via a new `send_weekly_summary_email`."

**Decision**: Build the script largely as proposed, with one deviation from the `backup_sqlite.py` analogy: it lives in a new `backend/scripts/` package (not the root-level `scripts/`), because it needs the full installed `app` package (models, DB session, email service) — unlike `backup_sqlite.py`/`restore_sqlite.py`, which are deliberately dependency-free so they can run in a bare `python:3.12-slim` container. Scheduling reuses the already-running `backend` container via `docker compose exec backend python -m scripts.send_weekly_summary_email` (wrapped as `make send-weekly-summary`), rather than standing up a new sidecar image or Compose service purely to sleep-loop for a week. Note the `-m` module form is required, not a plain file path — the container's `app` package is only importable when the invoked script's own directory resolves to `/app` (as `run.py` does); a script under `/app/scripts/` needs `-m` so Python adds the working directory (`/app`) to `sys.path` instead of the script's own subdirectory.

**Rationale**: A `backend`-package-dependent script cannot run in the generic `python:3.12-slim` image the existing backup sidecar pattern uses without installing `app` into that image — duplicating the backend's dependency footprint into a second container for a once-a-week job is disproportionate. Executing inside the already-running, already-dependency-complete `backend` container via `docker compose exec` is simpler and has no new operational surface (no new image to build, version, or keep in sync).

**Consequences**: The weekly send is not visible in `docker compose ps` as its own service — it's an on-demand `exec`, so monitoring/alerting on it must watch host-crontab log output (`docs/deployment.md` documents `>> /var/log/prompt-maker-weekly-summary.log`) rather than container health. If a future job needs sub-daily scheduling or retry/backoff semantics, this ad hoc `cron` + `exec` approach should be revisited in favor of a real task queue.

**Source**: `backend/scripts/send_weekly_summary_email.py`, `backend/app/services/analytics_service.py` (`weekly_digest`), `backend/app/services/email_service.py` (`send_weekly_summary_email`), `Makefile`, `docs/deployment.md`

---

## Real Per-Variable Type and Description

**Status**: Partly superseded 2026-10-11 — descriptions remain as hints; types are stored but no longer edited

**Context**: The Variables panel's type badge (shipped 2026-07-12) was a static, non-enforced `"text"` label with no persisted description, deliberately left that way rather than building "fake-looking type validation ... a trap for users." `product/BACKLOG.md` proposed a `variable_metadata` JSON column for description only; this pass extended the scope to also make *type* real, since type was the other half of the original gap.

**Decision**: Add `prompts.variable_metadata` (migration 012) — a JSON object keyed by variable name, each entry `{type: "text"|"number"|"boolean"|"list", description}`. The Editor's Variables panel gets a real, persisted type `<Select>` and description `<Input>` per detected `{{variable}}`. The Playground now renders a type-appropriate input control (`type="number"` input, a `Toggle` for boolean, `Textarea` for text/list) instead of always a generic textarea — this is what makes the type meaningfully real rather than cosmetic.

**Rationale**: A native `type="number"` input already guarantees its value is numeric-or-empty at the DOM level (browsers reject non-numeric keystrokes), so an initial pass adding a client-side "is this a valid number" check on top of it was redundant — jsdom-based testing confirmed the invalid-value code path was unreachable through normal typing, so it was removed rather than kept as untestable, effectively-dead validation. The type-appropriate *input control* itself is the real, observable behavior change; no additional enforcement was layered on.

**Consequences**: Variable substitution (`compile_prompt` on the backend, `compilePrompt` in `lib/placeholders.ts` on the frontend) still treats every value as a plain string regardless of declared type — `variable_metadata` changes what control is shown and what gets persisted as documentation, not the substitution mechanism. `[Insert ...]`-style placeholders (the other branch of `extractPromptPlaceholders`) can also receive type/description like any `{{var}}` row; no special-casing was added to exclude them.

**Source**: `backend/app/database/migrations/registry.py` (012), `backend/app/models/prompt.py`, `backend/app/schemas/` (`VariableMetadataItem`), `frontend/src/components/EditorDetail.tsx`, `frontend/src/components/PlaygroundView.tsx`

---

## Persist Evaluation Runs with Version Context and Denormalized Results — Migration 014

**Status**: Accepted

**Context**: Repeatable prompt evaluation needs to remain understandable after a test case is edited or deleted. It also needs to distinguish an automatic substring check, an AI-judged rubric, and a result that only a person can rate.

**Decision**: Store per-prompt eval cases with one of three scoring methods (`rule`, `judge`, `manual`). Each eval run records the current prompt version number, while each result copies the case method and label, stores the model output, and keeps only a nullable reference to the originating case. Manual results remain pending until a 1–5 star rating is submitted.

**Rationale**: Denormalizing the descriptive result fields preserves meaningful history even when the live eval set changes. Version context makes scores traceable to the prompt state under test. The three methods provide deterministic checks, flexible rubric-based grading, and human judgment without pretending they are equivalent.

**Consequences**: Rule scoring was initially limited to comma-separated substring presence (extended 2026-07-18 with prefix operators — see "Rule Criteria Operators as In-String Prefix Syntax" below). Judge scoring uses a fixed rubric and the active connection's model, which also executes each test case; there is no centrally pinned judge model. Custom judges and multi-model comparisons remain backlog items.

**Source**: `backend/app/models/eval_case.py`, `backend/app/models/eval_run.py`, `backend/app/models/eval_run_result.py`, `backend/app/services/eval_service.py`, `backend/migrations/014_create_eval_tables.sql`

---

## Eval Run Reproducibility Metadata — Migration 015

**Status**: Accepted

**Context**: `EvalRun` (migration 014) recorded only the prompt version and aggregate score. `EvalService.run_evaluation` already calls the billed `PlaygroundService` per case and a separate Judge grading call, and reads back latency/tokens/cost/model each time — but discarded all of it except `output_text`. Without it, a user comparing two eval runs of the same prompt version can't tell whether a score moved because the prompt changed or because the resolved model, a case's criteria, or the Judge model drifted between runs.

**Decision**: `EvalRun` gains `model` (the resolved execution model, shared across every case in the run) and aggregated `total_latency_ms`/`total_prompt_tokens`/`total_completion_tokens`/`total_cost_usd`, summed across every case run plus every Judge grading call. `EvalRunResult` gains a snapshot of the originating case's `criteria`/`variables` and, for Judge-method cases, the `judge_model` actually used — independent of the live `EvalCase`, which may be edited or deleted later.

**Rationale**: Aggregating on `EvalRun` rather than adding per-case cost/latency columns to `EvalRunResult` matches what the backlog actually asked for (run-level reproducibility and cost visibility) without doubling the columns added to the higher-cardinality results table. Snapshotting criteria/variables/judge model on the result — the same denormalization pattern migration 014 already used for `method`/`label` — keeps historical runs meaningful after a case edit, consistent with that migration's rationale.

**Consequences**: A single eval run's own cost isn't reflected in `playground_runs.cost_usd` (only the per-case `PlaygroundService.run` calls are — the Judge grading call never was and still isn't persisted to that table), so `AnalyticsService`'s Dashboard cost figures and the new budget ceiling in `product/DECISIONS.md`'s budget entry did not include eval-run cost until the unified `billed_calls` ledger (2026-07-18) began recording every billed call path. Custom Judge system-prompt/model overrides remain a separate backlog item ("Custom Eval Judges"); this migration only snapshots whichever judge model is currently hardcoded.

**Source**: `backend/app/database/migrations/registry.py` (015), `backend/app/models/eval_run.py`, `backend/app/models/eval_run_result.py`, `backend/app/services/eval_service.py`, `frontend/src/features/evaluation/EvaluationPage.tsx`

---

## API Spend Budgets Enforced Against Historical Playground Cost, Server-Controlled Only

**Status**: Superseded by the unified spend ledger and bring-your-own/default-provider decisions below; operator-controlled budget ceilings remain supported.

**Context**: Every user shares the one operator `OPENAI_API_KEY` (see "Playground Uses the Operator's OpenAI Key" above). Per-route rate limits (10/min Playground, 10/min eval runs, 10-20/min refine) bound request *frequency* but not spend — a single eval run can already fan out to 20 case calls plus 20 Judge calls, and nothing capped cumulative dollar spend.

**Decision**: Two optional operator env vars, `GLOBAL_MONTHLY_BUDGET_USD` and `USER_MONTHLY_BUDGET_USD`, each unset by default (meaning unlimited). `BudgetService.check()` sums `playground_runs.cost_usd` since the start of the current calendar month (global, and separately per calling user) and raises before any billed OpenAI call — Playground run, each eval case run, each Judge call, eval-case generation, and both refine endpoints — if either ceiling has already been reached. Rejections return HTTP 402, mirroring the existing "OpenAI quota exceeded" convention for `RateLimitError`. The (then-unauthenticated) `GET /api/prompts/config` reports only the *global* ceiling's exhausted/remaining state; the Playground and Evaluate UIs use that to proactively disable their run actions with a notice, the same pattern already used for the AI capability flag. *(That endpoint became authenticated and per-user in 2026-07-26's bring-your-own-provider change; the global budget snapshot it carries is unchanged.)*

**Rationale**: Reusing `playground_runs.cost_usd` — the same ledger `AnalyticsService` already aggregates for the Dashboard — avoids a second cost-tracking mechanism. Checking immediately before every billed call ensures all AI paths honor a ceiling that has already been reached according to that ledger. Env-var-only configuration keeps budgets server-controlled, consistent with the Icebox decision against per-user BYO keys — a threshold is an operator cost-control lever, not a user-editable setting.

**Consequences**: The ceiling is not a comprehensive measure of all OpenAI spend. Eval-case execution, Judge grading, eval-case generation, and refinement calls do not write their cost to `playground_runs`, so they are checked against the recorded Playground total but do not move that total themselves. A large evaluation therefore cannot trigger the ceiling mid-run based on its own spend. *(Resolved 2026-07-18: the unified `billed_calls` ledger — see the spend-ledger decision below — now records every billed call path, and `BudgetService` reads it.)* Monthly windows are fixed (calendar month, UTC) with no admin UI to reset or adjust mid-cycle.

**Source**: `backend/app/services/budget_service.py`, `backend/app/api/routes.py`, `backend/app/api/eval_routes.py`, `backend/app/api/refine_routes.py`, `backend/app/schemas/` (`PromptsConfigResponse`), `frontend/src/components/PlaygroundView.tsx`, `frontend/src/features/evaluation/EvaluationPage.tsx`

---

## AI-Generated Eval Cases Are Reviewable Proposals, Not Writes

**Status**: Accepted

**Context**: AI assistance can reduce the effort of building an eval set, but generated cases may contain unsuitable variables, weak criteria, or an inappropriate scoring method. Persisting them immediately would silently alter the user's test suite and could consume the prompt's 20-case allowance with low-quality cases.

**Decision**: `POST /api/prompts/{id}/eval/cases/generate` returns up to 10 structured proposals derived from the current template, variable metadata, and an optional testing goal. The endpoint does not write `EvalCase` rows. The current Evaluate workspace opens a proposal through Review and add, exposes its method, criteria and variables for editing, and persists it only on Save test case. Discard suggestions clears the unsaved proposals; there is no per-proposal Reject control.

**Rationale**: Review-before-save keeps the user in control while reusing the existing ownership, validation, ordering, and case-limit behavior of normal case creation. It also avoids creating a second bulk-write path with different persistence semantics.

**Consequences**: Unsaved proposals disappear on navigation or reload. Generation is a billed, budget-checked OpenAI call and is rate-limited to 10/minute. The backend caps proposals to the remaining capacity under the 20-case limit, but accepted cases can still require user refinement before they are useful quality gates.

**Source**: `backend/app/api/eval_routes.py`, `backend/app/services/eval_generator_service.py`, `backend/app/schemas/`, `frontend/src/features/evaluation/EvaluationPage.tsx`

---

## Prompt Preflight Is Deterministic, Advisory, and Shared in the Frontend

**Status**: Superseded 2026-10-11 — replaced by inline, per-section checks in the editor

**Context**: Users can copy or execute templates containing unresolved placeholders, unbalanced XML, empty sections, stale variable metadata, or unusually large content. Some of those conditions may be intentional, and turning every warning into a backend validation error would break existing prompt workflows.

**Decision**: Implement preflight as deterministic frontend checks shared by the copy output, Playground, and Evaluate entry points. Findings are displayed through one reusable panel and never block the underlying action. The checks do not call OpenAI and do not change backend request schemas or compilation behavior.

**Rationale**: A shared pure function gives immediate, cost-free feedback and consistent wording at every execution boundary. Advisory severity preserves backward compatibility and lets advanced users proceed when a warning is intentional.

**Consequences**: API clients do not receive preflight feedback, and direct backend calls can still submit templates that the UI would warn about. The checks identify structural risks, not semantic prompt quality, and must remain synchronized with placeholder parsing and supported template conventions.

**Source**: `frontend/src/lib/preflight.ts`, `frontend/src/components/ui/PreflightPanel.tsx`, `frontend/src/components/OutputPanel.tsx`, `frontend/src/components/PlaygroundView.tsx`, `frontend/src/features/evaluation/EvaluationPage.tsx`

---

## Rule Criteria Operators as In-String Prefix Syntax, Not Structured Assertion Config

**Status**: Accepted

**Context**: Rule-method eval criteria were interpreted only as a comma-separated list of required substrings — unable to express “must not contain”, pattern matches, or “output must be valid JSON”. The backlog proposal (“Rich Deterministic Eval Assertions”) suggested explicit assertion types with structured configuration; that would have meant a new criteria schema, a migration for existing `EvalCase` rows, and a richer criteria-builder UI.

**Decision**: Extend the existing free-text `criteria` string with prefix operators instead: `!term` (not-contains), `~pattern` (regex), and `{json}` (output parses as valid JSON); everything else remains a plain contains-substring term. Splitting became bracket-aware (`()`, `[]`, `{}`) and backslash-escapable so regexes like `~\d{2,3}` survive as one term, while plain comma-separated criteria tokenize exactly as before. Operators are documented in the UI placeholder, the API schema description, and model comments.

**Rationale**: In-string operators are fully backward compatible — every existing case keeps its meaning with no migration and no schema change — and reuse the entire existing criteria pipeline (persistence, CSV import/export, run-result snapshots, the AI eval-case generator). A structured assertion config remains the right shape if JSON-path value checks or numeric-range assertions are added later, but was disproportionate for the three operators that cover most deterministic needs.

**Consequences**: A literal leading `!` or `~` in a wanted substring now needs awareness of the operator syntax (unprefixed terms starting with those characters are interpreted as operators). CSV-imported criteria get operator semantics automatically. The unshipped tail (JSON-path value checks, numeric ranges) is tracked in `product/BACKLOG.md` as the remaining scope of “Rich Deterministic Eval Assertions”.

**Source**: `backend/app/services/eval_service.py` (`_split_criteria`, `_score_rule`), `backend/app/schemas/`, `frontend/src/features/evaluation/EvaluationPage.tsx`

---

## Judge Grading Returns Structured Feedback and Sees the Compiled Prompt, with Per-Case Failure Capture

**Status**: Accepted

**Context**: The Judge eval method originally returned an opaque free-text rationale, graded the model output *without* seeing the prompt that produced it, and any judge-side failure (API error or an unparseable response) could abort the entire eval run — discarding results for cases that had already completed successfully.

**Decision**: The judge call now uses a strict JSON schema response — integer `score`, `strengths` list, `weaknesses` list, and a short `rationale` — stored as JSON in the existing rationale field and rendered by a dedicated `JudgeRationale` component. The grading request includes the compiled prompt as context, char-capped (6k prompt / 12k output) so a pathological case can’t blow up judge token spend. Judge response parse failures raise `JudgeError` and are captured per-case exactly like judge API errors; OpenAI client construction failures in `PlaygroundService.run` wrap into `PlaygroundRunError` instead of escaping as a 502.

**Rationale**: A judge that can’t see the prompt is grading against the rubric alone — showing it the compiled prompt materially improves grading relevance at bounded token cost. Structured strengths/weaknesses make a low score actionable rather than a bare number. Per-case failure capture preserves the paid-for results of every case that did complete, consistent with how case-run errors were already handled.

**Consequences**: Historical judge rationales stored as plain text still render (the UI falls back to raw text when the rationale isn’t parseable JSON). The char caps mean a very large compiled prompt is truncated in the judge’s view — noted with an explicit truncation marker. The judge rubric and model remain hardcoded; user-configurable judges stay a backlog item (“Custom Eval Judges”).

**Source**: `backend/app/services/eval_service.py`, `backend/app/services/playground_service.py`, `frontend/src/features/evaluation/EvaluationPage.tsx`

---

## Unified AI Spend Ledger (`billed_calls`) with No Backfill — Migration 016

**Status**: Accepted for the shared spend ledger; original Dashboard displays were retired in 0.3.0. Pricing and failed-attempt capture were subsequently extended.

**Context**: Budget ceilings and the Dashboard spend figure summed only `playground_runs.cost_usd`, while eval case runs, Judge grading, eval-case generation, refinement, and AI parse billed the shared operator key without recording their cost anywhere the budget could see. The budget decision above explicitly flagged the gap: a large evaluation could not trip the ceiling on its own spend.

**Decision**: A `billed_calls` table (migration 016: `user_id`, `source` discriminator, `model`, token counts, `cost_usd`, `created_at`) is written by every billed OpenAI call path via `spend_ledger.record_billed_call()`, which computes cost from the shared `PRICING` table and deliberately does not commit — the caller owns the transaction, so an eval run's many ledger rows ride its single end-of-run commit. `BudgetService` and the Dashboard's total-spend figure now read `billed_calls`; average cost-per-run stays on `playground_runs` (it is per-Playground-run by definition). The previously uncovered parse-text endpoint also gained a budget check. Existing `playground_runs` rows are not backfilled.

**Rationale**: One append-only ledger answering "what did we spend" is simpler and more complete than teaching the budget to union several feature tables. Skipping backfill keeps the query trivial and avoids any double-counting risk; the cost is that month-to-date budget visibility resets once at deploy — in the user's favor, on an opt-in feature.

**Consequences**: The refiner, parser, and eval-generator services now return `(result, usage)` tuples so their routes can record spend (they previously discarded `response.usage` entirely). `playground_runs.cost_usd` continues to exist for run history and per-run analytics but is no longer the budget's source of truth. The Dashboard's "Total cost" card was relabeled "Total AI spend" since it now includes eval/refine/parse usage and diverges from cost-per-run × runs.

**Amendment — current billing boundary**: Costs resolve through provider/model pricing, not a fixed shared OpenAI table. The spend ledger remains the budget source; there is no product Dashboard. Completed usage is retained across structured-output retries and failures, and evaluation workers return usage for persistence on the request thread. Optional server-default calls use the same ledger and budgets.

**Source**: `backend/app/models/billed_call.py`, `backend/app/services/spend_ledger.py`, `backend/app/services/budget_service.py`, `backend/app/services/llm_pricing.py`, `backend/app/database/migrations/v016_billed_calls.py`

---

## Eval Runs Fan Out on a Thread Pool with One Batch Budget Pre-Check

**Status**: Accepted for thread-pool fan-out and batch budget pre-check; the separate 90-second future ceiling was removed, as amended below.

**Context**: `EvalService.run_evaluation` executed up to 20 cases strictly sequentially inside one synchronous HTTP request — a Judge-heavy set meant up to 40 back-to-back OpenAI calls, risking Caddy/browser timeouts that would waste the whole run's billed spend. This was the final unresolved finding from the pre-launch evaluation and refinement audit. The judge's OpenAI client also had no timeout at all (SDK default ~10 minutes).

**Decision**: Case execution fans out across a `ThreadPoolExecutor` (5 workers) of pure functions that touch no SQLAlchemy session or ORM object; all persistence stays on the request thread, collecting futures in submission order so results persist in case order with unchanged semantics and still one end-of-run commit. Each case future gets a 90-second ceiling that records a normal failure row ("timed out") instead of hanging the request, and the judge client gains the same 30s timeout as the Playground client. The per-billed-call `BudgetService.check` calls became one batch pre-check before dispatch. Threads were chosen over asyncio because the whole call chain (sync route handler, sync OpenAI SDK usage) is synchronous today — an async conversion would be a much larger, riskier change for the same latency win.

**Rationale**: Parallelism cuts a worst-case run from ~40 sequential calls to ~8 waves of 5, comfortably inside proxy timeouts, without introducing the persistent-job machinery that the backlog's progress/cancellation item will eventually need. Keeping workers session-free sidesteps SQLAlchemy/SQLite thread-safety entirely.

**Consequences**: A ceiling crossed mid-run no longer halts remaining cases — bounded by the 20-case cap, and the run's own ledger rows (see the spend-ledger decision above) block the next billed call. Tests that rely on sequential mock call order pin `max_workers=1`. The run remains a single synchronous request; per-case progress and cancellation stay on the backlog.

**Amendment — provider timeouts and usage retention (0.5.0)**: The service waits for workers to settle, captures returned usage even after invalid output or a failed judge, and performs database writes on the request thread after provider work. Each worker receives operation context with `copy_context`. Provider I/O timeouts replace the future deadline, which could not stop a running call and lost billed usage; this is not an end-to-end wall-clock deadline.

**Source**: `backend/app/services/eval_service.py`, `backend/tests/test_eval_service.py`

---

## Monotonic Prompt IDs on SQLite — Migration 018

**Status**: Accepted

**Context**: SQLite can reuse the highest deleted `INTEGER PRIMARY KEY`. Prompt IDs appear in durable Editor and Playground URLs, so reuse could make an old URL resolve to an unrelated prompt.

**Decision**: Keep a single-row `prompt_id_sequence` high-water mark and explicitly allocate IDs for every application prompt-creation path on SQLite. PostgreSQL keeps its native sequence behavior.

**Rationale**: A small allocator avoids a destructive rebuild of the heavily referenced `prompts` table solely to add SQLite's `AUTOINCREMENT` keyword. Each allocation also reconciles against the live maximum, so direct maintenance inserts cannot move the allocator backward.

**Consequences**: Deleted prompt IDs remain gaps permanently. New prompt-creation paths must call `PromptIdService.next_id`; direct model inserts in tests may still use SQLite defaults because the allocator reconciles before its next application allocation.

**Source**: `backend/app/services/prompt_id_service.py`, `backend/app/database/migrations/registry.py` (018), `backend/app/api/routes.py`

---

## Explicit Eval-Case Names and Intentionally-Empty Semantics — Migration 017

**Status**: Accepted

**Context**: Positional case labels made run history hard to scan, while robustness cases with deliberately blank variables triggered a permanent preflight warning indistinguishable from incomplete setup.

**Decision**: Eval cases persist an optional `name` and an `intentionally_empty` boolean. Names become the run-result label when present. The current case form requires each detected input unless the user explicitly selects This case intentionally leaves inputs blank; the Run action follows the same rule. Suggested cases open for review with that acknowledgement cleared, so the user must fill inputs or opt into blank placeholders.

**Rationale**: Persisted intent survives reloads, duplication, and CSV round trips while requiring an explicit choice before saving or running incomplete cases.

**Consequences**: CSV exports include `name` and `intentionally_empty` metadata columns after the required `method,criteria` prefix. Older imports remain valid.

**Source**: `backend/app/models/eval_case.py`, `backend/app/api/eval_routes.py`, `frontend/src/features/evaluation/EvaluationPage.tsx`

---

## Prompt Field Content Is Not HTML/XML-Entity-Escaped

**Status**: Accepted — reverses the escaping introduced for "Blocker #2" in an earlier audit

**Context**: `PromptGeneratorService.generate` originally embedded field content as-is; an earlier pre-launch audit flagged that unescaped `<`, `>`, `&` produced a generated block that wouldn't parse as strict XML (`xml.etree.ElementTree`), and the fix was to run content through `xml.sax.saxutils.escape`. A later independent audit (2026-07-19) flagged the opposite problem: that escaping is applied at the generation source, so the escaped `&lt;b&gt;` form is what gets persisted, shown in the Compiled view, copied to the clipboard, and emitted in the Export Code snippets — a user who types `<b>html</b>` or `cars & trucks` gets a corrupted artifact back everywhere they read or reuse their own prompt.

**Decision**: Removed the `escape()` call. Field content now passes through `generate()` byte-for-byte; only the field-name-derived `<TAG>` wrapper is real markup.

**Rationale**: Nothing in this app parses the generated prompt as strict XML at runtime — the `<GOAL>`/`<AUDIENCE>`-style tags are a convention for the LLM reading the prompt (the same pattern Claude's own docs recommend), not machine-parsed structure. The one caller that ever did (`ElementTree.fromstring`) was a test asserting well-formedness for its own sake, not a real consumer. The current section-level checks in `frontend/src/lib/sections.ts` and `frontend/src/features/editor/SectionCard.tsx` flag uneven tags as advisory notices, tolerating content that includes stray `<`/`>`/`&`. Given that, content-fidelity through save/compile/copy/export is the correct thing to guarantee, not strict XML well-formedness.

**Consequences**: A field value containing a bare `</TAG>`-shaped line can look like a wrapper boundary in the preview. It remains text rendered by React, not executable HTML; the old OutputPanel syntax-highlighting component was retired. If a future feature needs to machine-parse the generated prompt as real XML, it will need its own escaping at that boundary, not a reintroduction of escaping at generation time.

**Source**: `backend/app/services/prompt_sections.py`, `backend/tests/test_prompt_sections.py`, `frontend/src/lib/sections.ts`, `frontend/src/features/editor/SectionCard.tsx`

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

**Status**: Amended by "Bring-Your-Own LLM Provider over an OpenAI-Compatible Transport" (below). Provider-specific I/O timeouts and retries replace the original uniform timeout, no-retry policy and separate evaluation future deadline.

**Context**: AI import, Playground execution, eval output generation and Judge grading, eval-case generation, and both refinement stages all run synchronously inside user-triggered HTTP requests. Some clients already set a 30-second timeout, while others inherited the OpenAI SDK's much longer default and could leave the UI waiting well beyond the reverse proxy's practical request window.

**Original decision**: Construct every OpenAI client with `timeout=30.0`. Keep evaluation's separate 90-second per-case future ceiling because one case may make both an output-generation call and a Judge call.

**Rationale**: A consistent upstream bound gives every billed AI feature predictable failure behavior, avoids multi-minute hung requests, and aligns service behavior with the Playground and proxy timeouts already used in production.

**Original consequences**: A slow upstream response fails the affected feature instead of waiting for the SDK default, without an automatic retry. Evaluation captures per-case Judge failures without aborting the whole run; other features return their established route-level failure responses.

**Amendment — current timeout and retry behavior**: `llm_client.py` now applies 30s for hosted providers, 180s for Ollama/vLLM and 120s for custom endpoints, overridable with `LLM_TIMEOUT_SECONDS`. The SDK permits one retry, and structured-output calls can make one further capability fallback. Evaluation waits for workers to settle and retains reported usage; the separate future deadline was removed because it could not cancel running calls and lost billed usage. These are I/O timeouts, not an absolute end-to-end deadline.

**Source**: `backend/app/services/llm_client.py`, `backend/app/services/llm_providers.py`, `backend/app/services/prompt_parser.py`, `backend/app/services/playground_service.py`, `backend/app/services/eval_service.py`, `backend/app/services/eval_generator_service.py`, `backend/app/services/prompt_refiner.py`

---

## Bring-Your-Own LLM Provider over an OpenAI-Compatible Transport

**Status**: Accepted for transport, encrypted credentials and per-user connections. "Bring-your-own only" is amended by the optional server-default decision below.

**Context**: Every AI feature — AI import, Refine questions/draft, the Playground, eval case runs, judge grading, eval-case generation — constructed its own `OpenAI(api_key=os.getenv("OPENAI_API_KEY"))` client at five separate call sites. That hard-wired the product to OpenAI and made the operator the payer for every user's usage. It blocked self-hosting (an Ollama or vLLM server on the operator's own hardware could not be used at all), blocked anyone without an OpenAI account, and made opening registration a direct financial liability. It also reversed two prior positions: the "Playground Uses the Operator's OpenAI Key" decision above, and the `product/BACKLOG.md` Icebox entry "Per-user BYO OpenAI keys", both of which deferred this work on the grounds that per-user credential storage was a materially larger, security-sensitive feature. It is — that judgment was correct; the tradeoff simply changed once portability and self-hosting became the goal.

**Decision**:

1. **Bring-your-own only.** Each user configures a provider connection in Settings → AI connection: a provider handle from a known registry (`openai`, `anthropic`, `gemini`, `ollama`, `vllm`, `custom`), an optional base-URL override, an API key, and a free-text model name. There is no operator fallback key; `OPENAI_API_KEY` is gone from the backend and from `docker-compose.yml`.
2. **OpenAI-compatible transport, not native SDKs.** Every provider is reached through its OpenAI-compatible chat-completions endpoint using the existing `openai` SDK with a per-provider `base_url`. No `anthropic` or `google-genai` dependency is added.
3. **One construction site.** `backend/app/services/llm_client.py` is the only place `OpenAI(...)` is constructed. `client_for(user)` resolves the acting user's connection or raises a typed `LLMConnectionError`; the five services take an `LLMConnection` as an argument.
4. **Prompt-carried JSON schema.** Four services need machine-readable JSON back. `response_format` is *not* portable: Anthropic's compatibility layer documents it as **silently ignored** (so a "try strict, fall back on error" strategy would never trigger — it returns prose with a 200), Ollama honours only the coarse `{"type": "json_object"}` form, and an arbitrary gateway may reject it outright. So `json_completion()` always puts the JSON Schema in the system prompt, layers `response_format` on top only where the provider registry says it helps, parses tolerantly (code fences, surrounding prose), and retries once at a lower capability rung. Token usage from every attempt is billed, because every attempt was really spent.
5. **Pricing keyed by `(provider, model)`.** `services/llm_pricing.py` replaces the model-keyed table in `playground_service.py`; `billed_calls` gains a `provider` column. Self-hosted providers price at 0.0. Unknown pairs originally degraded to 0.0; current spend-ledger estimates use conservative fallback rates when either monthly ceiling is configured. Missing usage can also receive a cost estimate, while recorded token counts remain the reported counts. Without a ceiling, unknown pairs remain unpriced in the catalogue and cost calculations return 0.0.
6. **Credentials encrypted at rest.** `services/secret_store.py` wraps Fernet from the already-vendored `cryptography` package. Key material comes from `LLM_ENCRYPTION_KEY` when set, otherwise it is HKDF-derived from `SECRET_KEY` so existing deployments gain encryption without a new mandatory variable.
7. **`users.default_model` retired from the API.** The model now lives on the connection; a second, separately-validated model preference had no coherent meaning. The column remains (migration 019 backfills `llm_model` from it, and SQLite cannot drop a column without rebuilding the table) but is no longer read or exposed.

**Rationale**: The OpenAI-compatible `base_url` approach buys support for four vendor APIs plus any self-hosted server for roughly the cost of a provider registry, versus an adapter layer per native SDK. Putting the JSON contract in the prompt for *everyone*, rather than branching on capability, means the fragile path (a provider that ignores `response_format`) is the same code path that is exercised constantly by the providers that don't — no untested fallback. A single client-construction seam is what makes the "which provider did this call use" question answerable at all, and is what the per-user isolation test asserts against.

**Consequences**:

- **Existing users must re-enter a key.** Migration 019 pre-fills `llm_provider='openai'` and `llm_model` from their old `default_model`, so the Settings form opens already pointing at what they were implicitly using — but deliberately **without** a key. The operator's shared `OPENAI_API_KEY` is never copied into user rows: fanning one credential across N database rows is a worse outcome than a signposted empty state. Until a user adds a key, AI features show a "Connect a provider in Settings" notice rather than failing at call time.
- **Budget ceilings apply to the active payer.** Users fund their own connections; the optional server default is funded by the operator. `GLOBAL_MONTHLY_BUDGET_USD` / `USER_MONTHLY_BUDGET_USD` cap recorded estimated spend before metered operations. Evaluations pre-check a conservative estimate for the complete batch, rather than checking each worker call. Checks do not reserve funds, so concurrent requests may overshoot. Ollama/vLLM calls add zero estimated spend, but a ceiling already reached can still block them.
- **Output quality varies by provider.** The prompts were tuned against OpenAI models. A small local model may return JSON that fails both attempts; that surfaces as an actionable "try a more capable model" error rather than a 500.
- **Judge grading uses the user's own model.** There is no operator-pinned judge model to fall back on, so `_score_judge` reuses the case's connection. Scores are therefore not comparable across users with different providers.
- **Provider I/O timeouts bound eval calls.** Hosted providers use 30s, Ollama/vLLM 180s and custom endpoints 120s per I/O operation, overridable via `LLM_TIMEOUT_SECONDS`, with one SDK retry and at most one structured-output fallback. Evaluation waits for workers to settle and records received usage, including unusable responses. A separate thread timeout was removed because it cannot cancel a running call and discarded completed spend. This is not an absolute end-to-end wall-clock deadline.
- **Base URLs are user-supplied server-side request targets.** They are validated at the boundary (http/https only, real host, no embedded credentials, no query/fragment), including provider defaults. Private and non-global addresses require `ALLOW_PRIVATE_LLM_URLS=true`. Public-only clients disable redirects and environment proxies and pin each request to a validated IP while retaining the original HTTP Host and TLS identity. Operator-configured server defaults remain trusted. Network-level egress restrictions remain useful defense in depth.
- **Key rotation.** Rotating `SECRET_KEY` (or `LLM_ENCRYPTION_KEY`) makes stored ciphertexts undecryptable. That surfaces as a typed `StoredKeyUnreadableError` and reaches the user as "re-enter your API key", never as a 500.

**Source**: `backend/app/services/llm_client.py`, `backend/app/services/llm_providers.py`, `backend/app/services/llm_pricing.py`, `backend/app/services/secret_store.py`, `backend/app/database/migrations/registry.py` (019), `backend/app/api/llm_connection_routes.py` (`/api/auth/me/llm-connection`), `backend/app/api/routes.py` (`GET /api/prompts/config`), `frontend/src/features/settings/LLMConnectionForm.tsx`

---

## Optional Operator Server-Default LLM

**Status**: Accepted (amends "Bring-your-own only" above)

**Context**: An operator running their own inference server (e.g. vLLM on a private network) wants every user on the instance to use it without each person entering the URL, model, and key. Per-user setup also forced `ALLOW_PRIVATE_LLM_URLS=true`, which opens a user-reachable SSRF path to private addresses just to reach one known host.

**Decision**: `LLM_BASE_URL` + `LLM_MODEL` (with optional `LLM_API_KEY` and `LLM_PROVIDER`, default `custom`) define a server default in `llm_client.py`. It is used only when a user has no usable connection of their own; a saved connection always wins. The URL is operator-trusted and skips the user-URL egress policy. The API exposes only the provider label and model, never the URL or key.

**Rationale**: Fallback rather than enforcement keeps bring-your-own intact and makes the change one branch in the single client-construction seam. Keeping the credential in env rather than copying it into user rows avoids the fan-out the BYO decision rejected.

**Consequences**: The operator funds fallback calls according to their provider agreement; budgets and route limits still apply, while self-hosted providers price at zero. Settings → AI connection shows the active default and lets a user connect their own provider. Disconnecting their own connection returns to a configured server default.

**Source**: `backend/app/services/llm_client.py` (`server_default`, `client_for`), `backend/app/api/llm_connection_routes.py`, `frontend/src/features/settings/LLMConnectionForm.tsx`

---

## Rename to Prompt Maker Studio Keeps Backward-Compatible Shims

**Status**: Accepted

**Context**: The product was renamed from "Prompt Maker" to "Prompt Maker Studio". The name had no single definition — it was a literal in ~14 frontend files (six of which set `document.title` imperatively with their own reset string), three duplicated inline wordmarks, nine backend strings, and the `prompt-maker` slug in container names, image names, package names, the Grafana dashboard, browser storage keys, and the HKDF `info` used to derive the encryption key for stored per-user LLM credentials. Two of those are load-bearing in a way a text replacement does not survive: renaming the HKDF context makes every stored API key undecryptable, and renaming the storage namespace signs every user out and discards their unsaved drafts.

**Decision**:

1. **One source of truth per stack.** `frontend/src/lib/branding.ts` exports `APP_NAME`, `APP_SLUG`, `pageTitle()`, and `storageKey()`; `backend/app/branding.py` exports `APP_NAME`. No user-visible name literal remains outside those two files.
2. **One `Wordmark` component.** `frontend/src/components/ui/Wordmark.tsx` replaces the three duplicated copies and is rendered in the authenticated sidebar and public/authentication surfaces. The accent colour falls on the last word of `APP_NAME`, derived rather than hardcoded.
3. **Storage keys migrate, they don't break.** `migrateLegacyStorageKeys()` copies any `prompt-maker:*` entry to `prompt-maker-studio:*` and removes the original. It runs at import time in `lib/auth.ts`, not in an effect, before the app reads expiry hints or browser drafts.
4. **Ciphertext falls back, then upgrades.** `secret_store.decrypt_secret()` retries the pre-rename HKDF derivation when the current one fails, and any subsequent write re-encrypts under the new one. The fallback is skipped when `LLM_ENCRYPTION_KEY` is set, since an explicit key is used verbatim and never went through HKDF.
5. **The Compose project name is pinned to `prompt-maker`.** Volume names derive from it, so the `prompt-maker_backend-data` volume holding the production database is unaffected by the rename — or by any future rename of the checkout directory.

**Rationale**: A rename is cosmetic by intent; letting it destroy user data or credentials would be a self-inflicted incident with no upside. Both shims are small, local, and self-limiting — each has a documented condition under which it can be deleted. Pinning the Compose project name is the cheapest possible insurance against the failure mode with the worst blast radius, and is a no-op today.

**Consequences**:

- Two compatibility paths now exist that will look like dead code to a future reader. Both carry comments naming the condition for removal: no active session predating the rename, and no ciphertext predating the rename.
- Published images move to `ghcr.io/<owner>/prompt-maker-studio-{backend,frontend}`. Deployments pinning the old image name must update `docker-compose.prod.yml` or their `IMAGE_TAG` source; the old tags are not republished.
- The Grafana dashboard UID changed, so bookmarked dashboard links break. Accepted — the dashboard is operator-facing and the provisioner recreates it on restart.
- The GitHub repository and checkout are now `prompt-maker-studio`; documentation and clone URLs use that slug. The Compose project and `prompt-maker_backend-data` volume retain `prompt-maker` to preserve existing data.

**Source**: `frontend/src/lib/branding.ts`, `frontend/src/components/ui/Wordmark.tsx`, `backend/app/branding.py`, `backend/app/services/secret_store.py`, `docker-compose.yml`

## Content-Security-Policy keeps `script-src 'unsafe-inline'`

**Decision.** The production CSP drops `'unsafe-eval'` but retains
`'unsafe-inline'` for `script-src`.

**Why.** A nonce is the correct fix and is what Next documents. It was
implemented and measured: Next serves its App Router flight data as roughly six
inline `<script>` blocks per document, and a nonce has to be minted per
response — but the then-static pages could not carry a per-request nonce. The result was a policy that parsed correctly, blocked the
app's own scripts, and left "Loading..." on screen. Build-time hashes are no
better: the inline contents differ per page and per build.

Public landing, guide and metadata routes now render dynamically, but there is
still no shared nonce propagation across middleware, application pages, Next.js
scripts and the theme bootstrap. Closing this requires an explicit CSP/rendering
change and validation across every route; it remains a documented hardening item.

**Consequences.** An injected script would still execute with the victim's
session, so XSS prevention in application code remains the primary control. The
exposure and its cause are stated in `SECURITY.md`, and `frontend/e2e/csp.spec.ts`
asserts the current policy — including a test that fails, on purpose, if
`'unsafe-inline'` is ever removed, so this entry gets revisited rather than
quietly outliving its reason.

---

## Redesign Around the Person Who Reuses Chat Prompts — 0.3.0

**Status**: Accepted (2026-10-11)

**Context**: The app had grown into a broad "prompt workbench" (dashboard, Playground, evaluations, refinement, analytics, notifications) with a generic look. Much of it was shallow, unused, or misleading for the people who actually use it.

**Decision**: Design for someone who writes prompts in ChatGPT, Claude or Gemini every day and wants a home for structured templates — moderately technical, not a prompt engineer. The core job is building, storing, finding and copying templates. Everything is judged against that job.

**Rationale**: A clear audience lets the product drop hand-holding copy and analytics, and makes "fill in and copy" the central action instead of in-app model runs the audience does not need.

**Consequences**: The library is the home page; one editor replaces two; features that do not serve the job were retired or deferred (see the next decisions). Validated with a clickable prototype before implementation.

**Source**: `product/VISION.md`, `frontend/src/features/editor/`, `frontend/src/app/(app)/library/page.tsx`

---

## Sections Are the Only Thing Clients Write — 0.3.0

**Status**: Accepted (2026-10-11)

**Context**: New prompts were built from fields, but saved prompts were edited as raw text, so `fields` and `generated_prompt` drifted apart. The MCP tools already re-rendered text from fields; the web editor did not.

**Decision**: The server renders `generated_prompt` from `fields` on every content write — create, PATCH, restore and MCP. Create and PATCH reject a client-sent `generated_prompt` (and other unknown keys) with 422 rather than ignoring it. Drifted data is recovered once by migration 023: originals are kept as a version, then sections are rebuilt from the text, split into tags only when that reproduces the text byte for byte and otherwise kept whole as one `prompt` section. Restoring an older drifted version applies the same recovery.

**Rationale**: One representation makes the web app, the ChatGPT plugin and the copied text agree by construction. Arbitrary edited XML does not round-trip safely, so a parse is trusted only when it is exact.

**Consequences**: Prompts recovered as one section copy with a `<PROMPT>` wrapper; the original text stays in their history. Output stays XML-style only.

**Source**: `backend/app/services/prompt_sections.py`, `backend/app/api/routes.py`, `backend/app/database/migrations/registry.py` (023)

---

## Section Names Are Display Names; Only the Tag Is Normalised — 0.3.0

**Status**: Accepted (2026-10-11)

**Context**: Field names had to be XML identifiers, so "Output format" became `Output_format` while typing.

**Decision**: Names may contain spaces (collapsed, must start with a letter or underscore); the rendered tag joins words with underscores and upper-cases them. Uniqueness is checked on the rendered tag, so `Role`/`role` and `a b`/`a_b` clash.

**Rationale**: Section names are what people read; only the model needs the tag.

**Consequences**: The MCP `save_prompt` contract accepts spaced names. Existing names are unchanged.

**Source**: `backend/app/schemas/`, `frontend/src/lib/sections.ts`

---

## Generate and History Give Way to Named Prompts — 0.3.0

**Status**: Accepted (2026-10-11)

**Context**: Every Generate click stored an unnamed prompt that only the History tab listed — a third notion of "past versions" next to saved prompts and version history.

**Decision**: Remove `POST /api/prompts/generate` and `GET /api/prompts/history`; the preview is live and prompts are saved explicitly by name (`POST /api/prompts`). Migration 024 names existing unnamed prompts by date and files them under "Recovered history" without deduplicating, since identical fields can still differ in edited text.

**Rationale**: Version history already covers going back; the History log mostly recorded clicks.

**Consequences**: Saving is explicit (button or Ctrl/⌘+S) with local draft recovery instead of autosave or an unsaved-changes prompt. Users can delete recovered prompts they do not need.

**Source**: `backend/app/api/routes.py`, `backend/app/database/migrations/registry.py` (024), `frontend/src/features/editor/PromptEditor.tsx`

---

## Folders Stay Labels; Tags Leave the Product — 0.3.0

**Status**: Accepted (2026-10-11)

**Context**: The library offered folders, tags and favorites — three overlapping ways to organise a personal list.

**Decision**: Keep flat folders as the `prompts.folder` label, shown in the sidebar, with bulk rename (merging onto an existing name) and remove (unfiling) endpoints that leave edit times alone. Retire tags from the UI, REST API and MCP tools, keeping stored tags in the database and the export.

**Rationale**: One home per prompt matches how chat assistants organise projects; favorites cover the cross-cutting case. A folders table is only worth it if empty or nested folders become a requirement.

**Consequences**: Empty folders cannot exist. MCP `list_saved_prompts` lost its `tag` filter and output — a tool-contract change.

**Source**: `backend/app/api/routes.py`, `backend/app/api/mcp_routes.py`, `frontend/src/components/shell/Sidebar.tsx`

---

## Retire Shallow and Misleading Features — 0.3.0

**Status**: Accepted (2026-10-11)

**Context**: Several features looked precise without serving the core job: usage dashboards and run counts, the standalone Playground for an audience that runs prompts in chat apps, OpenAI code snippets, a characters÷4 token estimate, a density setting, a compile animation, and four kinds of notification email.

**Decision**: Remove them end to end — UI, endpoints, services, metrics and Grafana panels, scripts and tests. Keep `PlaygroundService` because evaluations use it, and keep retired preference columns because SQLite cannot drop a column without a table rebuild.

**Rationale**: Leftover endpoints and settings are themselves misleading surface, and dead code still costs tests under the coverage gate.

**Consequences**: Operators must remove any `make send-weekly-summary` cron entry. API clients of the removed endpoints break; this is a 0.x release with the changes listed in the changelog.

**Source**: `CHANGELOG.md` (0.3.0), `backend/app/models/user.py`, `monitoring/grafana/provisioning/dashboards/`

---

## Refine and Evaluate Are Deferred, Not Removed — 0.3.0

**Status**: Superseded by the refinement/evaluation restoration decisions below. Automatic evaluation remains disabled.

**Context**: Refinement and evaluation are expected to matter, but their behaviour was closer to placeholder than useful.

**Decision**: Hide their UI and keep their backends, data and tests until a rebuild around clear user goals and understandable evidence. Remove the automatic evaluation trigger so stored preferences can never cause invisible spending, but keep the preference columns.

**Rationale**: Restyling screens that will be re-engineered is wasted work; deleting working backends and data would be destructive.

**Consequences**: The deferred endpoints remain reachable through the API only. When they return, automated scoring should be checked against human judgments.

**Source**: `backend/app/api/refine_routes.py`, `backend/app/api/eval_routes.py`

---

## Coral and Plum, One Typeface, Restyled in Place — 0.3.0

**Status**: Accepted (2026-10-11)

**Context**: The previous blue-black theme, Inter everywhere, gradients, glows and all-caps labels read as a generated app.

**Decision**: Keep the coral brand and mark; add plum for navigation and selected states and a deep-plum preview pane in both themes; use Hanken Grotesk for UI and prompt prose and JetBrains Mono only for tags and the preview, self-hosted at build time; default to light. Restyle the existing CSS Modules and tokens rather than adopting Tailwind or a component kit; allow one decorative motif (the dot grid behind the sign-in sample).

**Rationale**: Distinct colour and a writing-tool feel for the text people work on, without decoration on working screens. Swapping styling systems would have added churn without addressing the real problem.

**Consequences**: Existing token names were kept and remapped, so all screens changed palette together. Every text pairing was checked against WCAG AA.

**Source**: `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`

---

## Restore Refinement Inside the Sections Editor

**Status**: Accepted (2026-10-11)

**Context**: The user requested refinement back in the UI, integrated with the redesigned editor. The retained API read saved templates and returned raw text, so simply exposing it would exclude unsaved work and risk section drift.

**Decision**: Refine replaces the desktop preview and becomes a native full-screen modal on phones. Users explicitly request questions and a draft, review section-level diffs, apply locally with Undo, then save normally. Closing retains the session in memory; changed source sections require restarting. Snapshot endpoints accept current sections without saving them; the old saved-prompt endpoints remain compatible. Drafts are requested as section objects and must retain the same section names/order and preserve per-section variable and tag occurrences. Completed draft calls are recorded in the spend ledger even when structural validation rejects the draft.

**Rationale**: Refinement belongs next to the text being improved. Explicit calls, review and ordinary Save make its effects clear while preserving sections as the only writable representation. Structural validation checks preservation, not whether the wording performs better.

**Consequences**: Refinement sessions do not survive navigation or reload. Apply preserves variable metadata and filled values. Evaluate was subsequently restored as an explicit workflow; no automatic evaluation is introduced.

**Source**: `frontend/src/features/editor/RefinePanel.tsx`, `frontend/src/features/editor/usePromptEditor.ts`, `backend/app/api/refine_routes.py`, `backend/app/services/prompt_refiner.py`



---

## Restore Evaluation as an Explicit Saved-Prompt Workflow

**Status**: Accepted, 2026-10-12

**Context**: The redesign kept evaluation data and API endpoints but removed their UI. Users need a readable way to check saved prompts against examples without rebuilding the backend or introducing another visual system.

**Decision**: Add an Evaluate action to saved prompts and a dedicated workspace with Test cases and Run history. Use the existing API for case editing, CSV transfer, reviewed AI suggestions, explicit runs and manual ratings. Compare historical outputs by case identity, flag changed inputs/scoring or models, and show the recorded run metadata. Keep the existing app palette, typography and shared controls.

**Consequences**: Evaluation is available again, but saving never runs it automatically. The stored evaluation preferences remain inactive. Suggestions are edited and saved individually; scores are shown without invented pass thresholds. Blank inputs retain placeholders, and require acknowledgement before a run. Aggregate scores wait for every pending manual rating; accumulated model time is labelled separately from elapsed duration. Calibration of automated scores remains backlog work.

**Source**: `frontend/src/features/evaluation/`, `frontend/src/lib/api/evaluation.ts`, `backend/app/api/eval_routes.py`

---

## A Public Landing Page at the Root

**Status**: Accepted

**Context**: `/` redirected to the library, whose auth check runs in the browser. Crawlers saw only "Loading...", there was no `robots.txt` or sitemap, and the hosted instance did not appear in search results.

**Decision**: Serve a server-rendered landing page at `/` for visitors without a session cookie, and redirect those with one to `/library`. Add `robots.txt` and `sitemap.xml`, and build the canonical link and social previews from `FRONTEND_URL` at request time. Screenshots are plain `<img>` copies under `frontend/public/landing/`.

**Rationale**: Checking the httpOnly session cookie on the server keeps returning users one hop from their library without client code on the landing page. The published image is domain-agnostic, so anything naming the public origin must be rendered per request. The image ships without sharp, so `next/image` would add nothing. The call to action says "Open the app", not "Create account", because `REGISTRATION_MODE` defaults to `closed`.

**Consequences**: Every deployment, self-hosted ones included, shows the landing page to signed-out visitors. The screenshots are copies of `docs/assets/` and must be refreshed by hand when those are regenerated. A stale cookie costs one extra redirect to the sign-in form.

**Source**: `frontend/src/app/page.tsx`, `frontend/src/app/robots.ts`, `frontend/src/app/sitemap.ts`

---

## Activity-Based Session Renewal Inside the Stateless JWT

**Status**: Accepted

**Context**: Sessions lasted a fixed 30 minutes from sign-in. `/api/auth/refresh` existed, but only a delayed prompt deletion opted into it, so users editing continuously were signed out mid-work, under a message that blamed inactivity. Separately, the recovery email could be changed with the session alone, and the password rule was 8 characters with no other requirement.

**Decision**: Keyboard and pointer input renew the session at most every 5 minutes. Tokens carry an `auth_time` claim set at login and password change; refreshes carry it forward and never extend a session past `MAX_SESSION_AGE` (12 hours) after it. Changing the email requires the current password and notifies the previous address. Sign-in accepts the username or the account email. New passwords need 10+ characters, a number and a special character.

**Rationale**: A server-side session table would add per-device sign-out and an active-sessions list, neither of which this product needs; the claim gives idle and absolute timeouts without reversing the stateless-JWT decision. Only deliberate input counts, so an open idle tab still expires. The email is what password recovery trusts, so a stolen session must not be able to redirect it. Usernames cannot contain `@`, so one login field resolves unambiguously. The composition rule was an explicit product choice; NIST SP 800-63B advises against composition rules, and the policy applies only when a password is set, never at login.

**Consequences**: An active user signs in at most every 12 hours. Existing passwords keep working until changed. Email changes are not verified by a link to the new address — a mistyped address breaks recovery until corrected. `MAX_SESSION_AGE` is a constant, not configuration.

**Source**: `backend/app/auth/utils.py`, `backend/app/api/session_routes.py`, `backend/app/services/accounts/profile.py`, `backend/app/schemas/accounts.py`, `frontend/src/features/auth/useSession.ts`, `frontend/src/features/auth/passwordPolicy.ts`

---

## Quieter Dark Surfaces, Plum Where It Means Something

**Status**: Accepted (2026-10-15)

**Context**: Dark-mode surfaces were all low-saturation mauve within a few lightness points of each other, so panels, canvas and sidebar barely separated. Screenshots of the real editor compared the current palette, a more saturated plum and a quieter variant.

**Decision**: Dark mode uses near-neutral, plum-tinted surfaces with clearer lightness steps, a distinctly plum sidebar and preview, plum selected states, and slightly softer coral. Light mode is unchanged. A saved theme is applied by an inline script before first paint on every page.

**Rationale**: More saturation alone barely improved separation and tinted everything purple. Concentrating plum on navigation and the preview keeps the 0.3.0 identity while giving content room. The preview stays distinct from the panels through hue, not just darkness.

**Consequences**: Signed-out pages now follow a saved dark preference. The dark text, accent and status colours were rechecked and clear WCAG AA on the canvas, sidebar, panel, raised, overlay and plum-wash surfaces.

**Source**: `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`

---

## Moodboard Direction for Dark Mode

**Status**: Partly superseded by "Dark Mode Shares Light's Layout" below; only the colour/surface direction remains.

**Context**: The owner supplied a dark-mode moodboard with a near-black canvas, aubergine satin surfaces, peach-coral actions, Inter UI typography and JetBrains Mono prompt blocks.

**Decision**: Apply that direction through dark-theme tokens and the existing CSS Modules. Dark mode gets subtle surface gradients, a floating bordered sidebar, section icons, and coral preview tags and selection indicators. Inter is self-hosted and used only in dark mode; light retains Hanken Grotesk and its existing layout. Muted text is slightly brighter than the moodboard swatch to maintain WCAG AA on raised surfaces.

**Rationale**: Shared theme tokens carry the visual treatment across the editor, library, settings, authentication and dialogs while preserving the app's current workflows.

**Source**: `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`, `frontend/src/components/shell/Sidebar.module.css`, `frontend/src/features/editor/SectionCard.tsx`, `frontend/src/features/editor/PromptEditor.module.css`

---

## Dark Mode Shares Light's Layout

**Status**: Accepted (2026-10-15). Supersedes the floating sidebar, section icons, Inter and radius parts of "Moodboard Direction for Dark Mode".

**Context**: The floating sidebar card, tighter spacing, section icons, a restyled preview header, Inter and smaller radii made dark mode lay out differently from light. The same folders fitted in one theme and scrolled in the other, and pages shifted when the theme changed.

**Decision**: Dark mode changes colour, surfaces and shadows only. The shell, sidebar, editor, preview, sign-in screen, spacing, radii and UI font are the same in both themes, and section icons are dropped. Dark-only outlines are drawn with `box-shadow` or `outline` so they take no space.

**Rationale**: Switching theme should never move content or change what fits on screen.

**Source**: `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`, `frontend/src/components/shell/Sidebar.module.css`, `frontend/src/components/shell/AppShell.module.css`, `frontend/src/components/ui/SegmentedControl.module.css`, `frontend/src/features/editor/PromptEditor.module.css`, `frontend/src/features/auth/AuthForm.module.css`


## Curated Hosted Model Choices with Legacy Connection Preservation

**Status**: Accepted (2026-10-17)

**Context**: Live hosted catalogues and free-text entry exposed older generations,
dated snapshots and models for unrelated operations in the AI connection form.

**Decision**: The provider registry owns ordered IDs and labels for OpenAI
(GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna), Anthropic (Opus, Sonnet and Haiku 5.5),
and Gemini (3.1 Pro preview, 3.8 Flash, 3.5 Flash-Lite). The connection response
includes these choices and estimated prices before credentials are saved. Hosted
catalogue endpoints and capability model lists reuse the registry without live
model discovery. Saving requires a listed ID. Local/custom providers keep manual
names and cached discovery. This supersedes the free-text hosted-model policy
in the bring-your-own connection decision; its transport choice still applies.

**Consequences**: Existing older connections and operator defaults still execute
with their configured model; there is no automatic migration or silent model
substitution. Settings identifies a legacy model and requires a current choice
before saving an update. The user can retain their encrypted key. Model updates
are deliberate registry edits, checked against official provider documentation;
preview choices are labelled. Pricing remains an estimate with unknown-price
support and the existing limitations for caching, long context and discounts.
Gemini Flash's fallback uses its post-introductory standard rate conservatively.

**Sources**: [OpenAI models](https://developers.openai.com/api/docs/models),
[Claude models](https://platform.claude.com/docs/en/models/overview),
[Gemini models](https://ai.google.dev/gemini-api/docs/models);
`backend/app/services/llm_providers.py`, `backend/app/services/llm_model_catalog.py`,
`frontend/src/features/settings/LLMConnectionForm.tsx`.

---

## Saved Prompts Open Ready to Fill and Remember Inputs Locally

**Status**: Accepted (2026-10-18)

**Context**: An external UX review (18 Oct 2026) found returning users had to tell
template editing apart from filling a prompt once. The focused reuse view existed
but opened only from the library's Fill and copy link, and filled inputs were
remembered only after Paste a prompt, so whether inputs persisted was unpredictable.

**Decision**: A saved prompt with variables opens in the focused reuse view from any
entry point, including after its first save, unless restored unsaved template edits
need to stay visible. Prompts without variables open in the editor. Edit template
remains the deliberate way to change wording. Filled inputs for every saved prompt
are kept in the account-scoped local draft, never on the server; the preview says
so, and Clear inputs removes them. New unsaved prompts keep their previous behavior.

**Consequences**: Opening a prompt to change its wording takes one extra click.
Inputs can hold sensitive text in browser storage until cleared, the saved prompt
changes, or the user signs out (explicit sign-out already removes drafts).

**Sources**: `frontend/src/features/editor/usePromptEditor.ts`,
`frontend/src/features/editor/PromptEditor.tsx`, `frontend/src/features/editor/PreviewPane.tsx`.

---

## One Library Entry Point for Existing Prompts

**Status**: Accepted (2026-10-18)

**Context**: The library offered New prompt, a Paste a prompt link and an Import prompts
button. The external UX review (18 Oct 2026) found that someone bringing one existing
prompt had to pick an implementation path before seeing it in the product, and that the
import dialog led with format rules.

**Decision**: The library shows New prompt and **Add existing prompts**. The latter opens
the import dialog, which accepts pasted text and files, keeps format rules in a disclosure,
and previews section text. A single pasted note offers Keep as written (no AI) or Make
reusable with AI, which hands the text once through session storage to the editor's
existing Paste a prompt flow rather than overwriting the user's new-prompt draft. The
editor keeps Paste a prompt for new and saved prompts. JSON favorites are applied after
creation because the create endpoint rejects extra fields.

**Consequences**: AI conversion from the library takes one more step (Preview), and the
no-AI path is the default. Full archive restore remains deferred (ROADMAP Later).

**Sources**: `frontend/src/features/library/ImportPrompts.tsx`, `frontend/src/lib/promptImport.ts`,
`frontend/src/features/editor/usePromptEditor.ts`.

---

## Control Boundaries Meet 3:1 Non-Text Contrast

**Status**: Accepted (2026-10-18)

**Context**: Earlier entries (palette remap, dark-mode recheck) state that colour pairings
clear WCAG AA; that check covered text only. Measured against WCAG 1.4.11, every border
token failed 3:1 (light `--color-border` on panel 1.32:1, dark 1.37:1, best case 2.02:1),
and inputs, selects and secondary buttons relied on those borders as their only edge.

**Decision**: Add `--color-control-border` (light `#8f7787`, dark `#86708f`) and
`--pv-control-border` for the preview's fill-in fields (light `#866b80`, dark `#76657f`).
Form fields, selects and secondary buttons use them; `--color-border` and
`--color-border-strong` stay for cards, dividers and other decoration, keeping the calm
palette. `frontend/src/app/__tests__/globals.test.ts` asserts text at 4.5:1 and control
edges at 3:1 on canvas, panel, raised, overlay and sidebar (plus plum-wash and the preview
surfaces) in both themes. This amends the AA statements above to cover non-text contrast.

**Consequences**: Controls look slightly more defined. Section cards keep their soft outline,
but their existing left rail now uses the control border, marking each borderless text area
at about 4:1 without boxing it in. Because that rail and the coral focus colour are similarly
bright, focus now outlines the whole card in coral in both themes (previously light changed
only the rail). Selected and error states keep their existing colours.

**Sources**: `frontend/src/app/globals.css`, `frontend/src/components/ui/Input.module.css`,
`frontend/src/components/ui/Select.module.css`, `frontend/src/components/ui/Button.module.css`.

---

## Imported Notes Drop Front Matter and Offer Placeholder Inputs

**Status**: Accepted (2026-10-19)

**Context**: A persona test (someone moving prompts out of Notion and Obsidian) found that
imported notes kept their YAML front matter and `# Title` line inside the prompt text, so both
appeared in library snippets and were pasted into chat assistants. Placeholders people already
write, such as `[TOPIC]`, `{audience}` or `<transcript>`, stayed plain text, and Make reusable
with AI filled inputs with that placeholder text as if it were a value.

**Decision**: Library import removes front matter and reads the rest of the note as Markdown, so
a leading `# Title` becomes the title and `##` headings become sections; a preview checkbox keeps
the original text instead. The preview lists placeholder spellings it recognises and converts
them to `{{inputs}}` only when asked, with Undo. AI conversion keeps such text as an input's
source phrase but leaves its value empty, names AI sections as display names, and receives the
note body with its title and folder carried through to Save.

**Rationale**: Front matter is note metadata, not instructions for a model. Placeholder detection
is a heuristic, so it stays an explicit, reversible offer rather than an automatic rewrite.

**Consequences**: Supersedes "all single-note text, including front matter, is preserved" from
"One Library Entry Point for Existing Prompts". A note with front matter and `##` headings now
imports as several sections, matching notes that already started with `# Title`.

**Sources**: `frontend/src/lib/promptImport.ts`, `frontend/src/features/library/ImportPrompts.tsx`,
`backend/app/services/prompt_parser.py`, `frontend/src/features/editor/usePromptEditor.ts`.

---

## Single-Section Prompts Copy as Plain Text by Default

**Status**: Accepted (2026-10-19)

**Context**: Notes imported or saved as written become one section, so every copy wrapped the
user's own text in `<PROMPT>` or `<TASK>` tags they never wrote. Plain-text copying existed but
sat behind Output options and the library menu.

**Decision**: When a prompt has exactly one section, the editor preview and the library's Copy
template default to plain text. Output options and the library menu (Copy with section tags) still
add the tags. Prompts with two or more sections keep tags by default.

**Rationale**: Tags separate sections; with a single section they separate nothing.

**Consequences**: Amends the "Output stays XML-style only" consequence of "Sections Are the Only
Thing Clients Write": stored `generated_prompt`, the API and the ChatGPT plugin still render tags;
only the default copy format in the web app changes.

**Sources**: `frontend/src/features/editor/PreviewPane.tsx`, `frontend/src/features/library/useLibrary.ts`,
`frontend/src/features/library/LibraryPage.tsx`.

---

## Vaults and Notion Exports Import as Downloaded

**Status**: Accepted (2026-10-19)

**Context**: A first-time-user test with a real Obsidian vault and Notion export found that
import took about six interactions per note, one file at a time, and that Notion's own export
formats (a `.zip`, or a database `.csv`) were read as one prompt of raw text.

**Decision**: The import dialog takes several files, a folder (skipping hidden folders such as
`.obsidian` and non-note files), dropped files and folders, a Notion `.zip`, and a `.csv`, and
merges them into one preview. Zips are read with the browser's own `DecompressionStream`
rather than a library; within an export, Markdown pages are preferred to the database CSV.
Notion page properties are removed only when they name familiar metadata, and only those
lines; a property holding the prompt text keeps its value. Tags (front matter, trailing
`#tags`, Notion Tags) suggest the folder, ahead of the parent folder's name. Titles already in
the library are skipped unless "Import a copy anyway" is ticked.

**Rationale**: Bringing an existing collection over is the first thing most new users do; it
should work with the files those tools produce, in one pass. Native decompression avoids a new
dependency and its notices. Skipping duplicates by default makes re-importing a vault safe.

**Consequences**: Amends "Imported Notes Drop Front Matter and Offer Placeholder Inputs": the
clean-up also covers Notion properties, callouts and trailing tags, and placeholders are now
chosen one by one with their wording kept as hints. ZIP64 archives (over 4 GB or 65,535
entries) are refused with advice to unzip first. The empty library now leads with Add
existing prompts.

**Sources**: `frontend/src/features/library/ImportPrompts.tsx`, `frontend/src/lib/promptImport.ts`,
`frontend/src/lib/importArchive.ts`, `frontend/src/features/library/LibraryPage.tsx`.

**Amended (2026-10-19)**: A second first-time-user test found notes rejected whole for headings
such as `## 1. Role` or `## Step 2: Draft`, and every CSV in a zip dropped whenever any page
was present, losing a database exported without its subpages. Headings now become valid,
unique section names on import (the API's section-name rule is unchanged). A database CSV is
skipped only when its rows were exported as pages (`X/` beside `X.csv`), across zips, split
parts and chosen folders, and `X_all.csv` is preferred to `X.csv`. The tidy-up also removes
Obsidian comments, Dataview queries and embedded files, unwraps highlights, and removes
Notion `<aside>` callouts, by the same reasoning as Obsidian callouts.

---

## Import Preview Selects, Flags and Imports up to 1,000

**Status**: Accepted (2026-10-19)

**Context**: The same first-time-user test found that a vault of more than 100 notes could
not be previewed at all, that templates, readmes and parent pages could not be left out,
and that a note with a title over 100 characters or a section over 10,000 characters was
skipped whole with a developer-style message.

**Decision**: The preview takes up to 1,000 prompts and imports the ticked ones one by one,
showing progress. Every prompt has a tick box: new prompts start ticked, prompts already in
the library start unticked (the earlier "Import a copy anyway" default). Notes are parsed
leniently: a long title or section is previewed with what to change, and a long section can
be split at paragraph breaks into numbered sections, losing no text. Nothing is shortened
silently. JSON exports and the final pre-write check stay strict. Skipped files are listed
with their reasons, and a title repeated within one import is flagged but stays ticked,
since different folders may hold different prompts.

**Rationale**: Each prompt is already created by its own request, so the old cap protected
nothing but made the commonest migration fail; progress covers the longer wait. Letting
people choose and fix in the preview is cheaper than importing and deleting afterwards.

**Consequences**: Amends "Vaults and Notion Exports Import as Downloaded" (duplicates are now
an unticked box rather than a separate copy option) and supersedes the 100-prompt limit in
`docs/saved-prompts.md`.

**Sources**: `frontend/src/features/library/ImportPrompts.tsx`, `frontend/src/lib/promptImport.ts`.

---

## Re-import Can Update Changed Prompts as a New Version

**Status**: Accepted (2026-10-19)

**Context**: People moving from Notion or Obsidian keep editing there and expect to bring
changes over, but importing again only offered a second copy of an edited note. Closing the
dialog also kept an unfinished preview that reappeared without explanation, and notes at the
top of a chosen vault were filed under the vault's own name.

**Decision**: When a previewed prompt's title matches a library prompt and its sections
differ, the preview offers Leave it as it is (default), Update it, or Import a copy.
Placeholders converted on the first import do not count as a change. Updating PATCHes the
sections (and merges any new variable settings) into the most recently matched prompt with
the version note "Updated from import" and its concurrency timestamp, keeping folder, title
and favourite. The dialog and landing page say importing is a one-time copy. Closing keeps
an unfinished preview; reopening says so and offers Start over. Notes directly inside a
chosen or dropped folder start Unfiled.

**Rationale**: Version history already makes an overwrite reversible, so an explicit update
is safe without building a sync. Keeping work on Close protects a long review from a
misclick, and saying so on reopening removes the confusion. The chosen folder is the
collection, not a category in it.

**Consequences**: Replaces the dialog's "existing prompts are never replaced" promise with an
explicit per-prompt choice; amends "Vaults and Notion Exports Import as Downloaded". Matching
is by title only, so a renamed note still imports as new. Two-way sync stays out of scope.

**Sources**: `frontend/src/features/library/ImportPrompts.tsx`, `frontend/src/features/library/useLibrary.ts`,
`frontend/src/app/page.tsx`.

---

## AI Review Agreement Is Measured with the User's Own Ratings

**Status**: Accepted (2026-10-20)

**Context**: AI-review scores are about to inform refinement and version comparisons, but
nothing showed whether they match the user's judgement. Each test case uses one scoring
method, so the same output never had both an AI score and a human rating.

**Decision**: A scored AI-review result accepts an optional 1–5 star rating through the
existing rate endpoint, stored in the new `eval_run_results.human_score` (stars × 20). The
AI score and the run average stay unchanged. Like a manual rating, it is final. Run history
reports "agreed on X of Y", where agreement means the AI score is within one star (20
points) of the user's rating, counted in the browser over the loaded runs.

**Rationale**: Re-using the rating endpoint and the existing star scale avoided a new
endpoint, table or scale conversion. Showing a count rather than a correlation keeps the
number readable and honest for the handful of ratings a person will give.

**Consequences**: Agreement reflects only loaded history pages; a server-side summary can
replace it if histories grow long. Failed AI reviews cannot be rated. Ratings cannot be
changed once saved. Migration 030 adds the column.

**Sources**: `backend/app/services/evaluation/results.py`, `frontend/src/lib/evaluationStatus.ts`,
`frontend/src/features/evaluation/RunResults.tsx`.

---

## Eval Runs Record the Text They Tested, Matched by Exact Text

**Status**: Accepted (2026-10-20)

**Context**: Refinement needs to test a draft before it is applied, and History needs to
know which versions were tested. A run recorded only the live version number, so it could
not test unsaved sections, and a restored version looked untested even when the same text
had been evaluated.

**Decision**: `POST /eval/runs` accepts optional unsaved `fields`, never saved. Every new
run stores its rendered template in `eval_runs.tested_prompt`; a run of text other than
the saved prompt records version number 0. Listing derives `tested_version` (the recorded
number, or for a draft the first saved version with the same text) and `matches_current`
by exact string comparison. Existing runs are not backfilled.

**Rationale**: Exact text is the identity that matters to a model and needs no hash
column; one extra query per list keeps it cheap. Version numbers recorded by older
releases could be off by one, so reconstructing their text would invent history.

**Consequences**: Supersedes the content-hash approach in the evaluation plan. Variable
settings are not part of the identity because they do not change the text a case compiles
from. Draft runs appear in Run history; refinement will start them (planned).

**Sources**: `backend/app/services/eval_service.py`, `backend/app/services/evaluation/results.py`,
`frontend/src/features/evaluation/EvaluationPage.tsx`.

---

## Refinement Uses Chosen Test Results and Checks Drafts Before Apply

**Status**: Accepted (2026-10-20)

**Context**: Refinement changed wording without evidence that the result was better, and
evaluation scores were not used anywhere else.

**Decision**: On saved prompts, Refine lists the latest run's scored results, weakest first,
with nothing preselected; the user chooses up to five. The draft request carries only their
IDs and the server loads, ownership-checks and trims the content, which the refiner treats as
untrusted data while counting what was checked as a requirement. After review, Check against
test cases evaluates the unsaved draft, plus the current sections unless a run already tested
that exact text, and shows the existing comparison view. Questions do not use test results.

**Rationale**: User choice avoids an invented failure threshold; sending IDs keeps model
outputs from being supplied or enlarged by the client. Reusing the unsaved-sections run and
comparison view kept the check small. Each case runs once, so the UI says differences can be
chance and reports AI-review agreement where AI review is involved.

**Consequences**: A check costs one or two evaluation runs and adds them to Run history.
Unsaved prompts have no test cases, so neither feature appears there. A long suite can still
exceed the two-minute client timeout (see the plan's persistent-jobs phase).

**Sources**: `frontend/src/features/editor/RefineTests.tsx`, `frontend/src/features/editor/RefinePanel.tsx`,
`backend/app/services/evaluation/results.py`, `backend/app/services/prompt_refiner.py`.

---

## Claude Subscriptions Reach the App Through the Connector, Not Sign-in

**Status**: Accepted (2026-10-20)

**Context**: The owner wanted the app's AI features to run on a Claude Pro/Max subscription
instead of an API key. Anthropic's terms do not permit third-party developers to offer
Claude.ai login, to route requests through Free, Pro or Max credentials on users' behalf, or
to collect, store or intermediate Claude.ai credentials or session tokens
(https://code.claude.com/docs/en/legal-and-compliance); since early 2026 this is enforced
server-side.

**Decision**: Do not add subscription sign-in, stored tokens or a server-side Claude Code
bridge. Instead, support Claude as a client of the existing MCP server: allow
`claude.ai` (Claude's hosted-app OAuth callback) in the default `OAUTH_REDIRECT_HOSTS`
alongside `chatgpt.com`, and document connecting Claude in Settings and `docs/mcp.md`. The
in-app AI features keep using an API key, the operator default, or a local model.

**Rationale**: As a connector, Claude does the AI work inside Anthropic's own apps on the
user's subscription, which the terms allow, and the server already met Claude's OAuth
requirements (401 discovery, DCR, S256 PKCE, `offline_access`, rotating refresh tokens,
form-encoded token requests, port-agnostic loopback, redirect host on the consent page).

**Consequences**: Refine, Try once, Paste-a-prompt conversion and evaluations still need an
API key or local model. Deployments with an explicit `OAUTH_REDIRECT_HOSTS` must add
`claude.ai`. Client ID metadata documents remain unimplemented; Claude falls back to dynamic
registration. Not yet verified against a live Claude account.

**Sources**: `backend/app/services/oauth_provider.py`, `frontend/src/features/settings/ConnectedAppsSettings.tsx`,
`docs/mcp.md`.

---

## One Known-Good Version per Prompt, and Test Status Matched by Text

**Status**: Accepted (2026-10-20)

**Context**: With runs tied to the text they tested, versions could show whether they were
tested, and users wanted a fixed point to compare edits against.

**Decision**: A prompt stores one optional `known_good_version`, set through the existing
PATCH (0 clears; validated against existing version numbers before anything changes; no new
version or content timestamp). History matches each version to the newest run of its exact
text (older runs by number) from the newest 100 runs, and shows nothing about tests when the
prompt has none. The library list adds `eval_status`/`eval_score` from one pass over the
user's runs and one grouped version query; untested prompts show nothing on their cards.

**Rationale**: A single mark covers "known good" without a milestones table. Reusing PATCH
kept one write path with the existing concurrency check. Hiding "untested" avoids labelling
the many prompts nobody evaluates.

**Consequences**: Runs of the known-good version are labelled in Evaluate but not chosen as
the default comparison, and refinement checks do not yet show the known-good result. Very
long run histories make the library query read more rows; it can move to SQL aggregation.
Duplicates start without a mark, since their history starts fresh.

**Sources**: `backend/app/services/prompts/library.py`, `backend/app/services/evaluation/results.py`,
`frontend/src/features/editor/HistoryPanel.tsx`, `frontend/src/features/library/LibraryPage.tsx`.
