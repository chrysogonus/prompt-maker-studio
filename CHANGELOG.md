# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, the public API and data model may change in
any release. See [Project status](./README.md#project-status).

## [Unreleased]

Prompt Maker Studio was developed privately; nothing has been published yet.
This section describes the initial release and stays here until the `v0.1.0`
tag is public, at which point it gets its date and its links.

It was preceded by a round of security, licensing, and data-protection
hardening — same-origin API routing, cascading account deletion, an SSRF egress
policy with closed-by-default registration, encrypted per-user provider
credentials, and a full third-party notice inventory. The individual changes are
listed below and in the commit history.

### Changed

- **Renamed to Prompt Maker Studio.** The product name is now shown in the app
  header on every page (previously only in the footer), on the sign-in screen,
  and in browser tab titles, outbound email, and the API's OpenAPI document. A
  single `frontend/src/lib/branding.ts` / `backend/app/branding.py` pair is now
  the source of truth, replacing the name literals that were scattered across
  ~14 components.
- Docker container, image, and network names, the Grafana dashboard, and both
  package names now use the `prompt-maker-studio` slug. **Operators**: the
  Compose project name is explicitly pinned to `prompt-maker` in
  `docker-compose.yml` so the existing `prompt-maker_backend-data` volume — and
  the database in it — is unaffected. Published images move to
  `ghcr.io/<owner>/prompt-maker-studio-{backend,frontend}`.
- Browser storage keys moved from the `prompt-maker:` namespace to
  `prompt-maker-studio:`. Existing entries are migrated automatically on first
  load, so sessions and unsaved drafts survive the upgrade.
- Stored per-user LLM API keys are re-encrypted under a renamed HKDF context.
  Deployments without an explicit `LLM_ENCRYPTION_KEY` transparently fall back
  to the previous derivation on read, so no user has to re-enter their key.

### Added

- **Bring your own LLM provider.** Each user now connects their own provider in
  Settings → API access — OpenAI, Anthropic, Google Gemini, a self-hosted
  Ollama or vLLM server, or any OpenAI-compatible endpoint — with their own
  base URL, model, and API key. Every AI feature (import, Refine, Playground,
  evaluation, eval-case generation, judge grading) runs against that
  connection and is billed by that provider directly. A "Test connection"
  action sends a one-token probe so a wrong key, endpoint, or model name is
  reported in the form rather than as a mystery failure inside a feature.
  See `product/DECISIONS.md`, "Bring-Your-Own LLM Provider over an
  OpenAI-Compatible Transport".
- `LLM_ENCRYPTION_KEY` and `LLM_TIMEOUT_SECONDS` environment variables. Both
  optional: the first defaults to key material derived from `SECRET_KEY`, the
  second to 30s for hosted providers and 180s for self-hosted ones.

### Security

- Per-user provider API keys are stored Fernet-encrypted (via the already
  vendored `cryptography` package) and are never returned by any endpoint —
  only a masked hint such as `sk-…4f2a`. Note that database backups now
  contain encrypted third-party credentials and should be protected
  accordingly.
- A user-supplied provider base URL is a server-side request target. It is
  validated at the boundary (http/https only, real host, no embedded
  credentials, no query or fragment), but private and loopback addresses are
  deliberately permitted so self-hosted inference servers work. The residual
  SSRF exposure on a publicly-registerable instance is documented in
  `SECURITY.md`.

- The backend now refuses to start on **any** signing key this repository has
  published, not just one of them. `.env.example`'s `SECRET_KEY` differed from
  the single value the startup guard compared against, so an instance launched
  from the unedited template booted successfully with a public key — every
  session token on it was forgeable. Keys shorter than 32 characters are
  rejected too, and `make setup` now generates a real key when it creates
  `.env`.
- `backend/scripts/seed_demo_user.py` no longer creates its known-credential
  demo account without `SEED_DEMO_USER=1`, and the deployment guide no longer
  instructs operators to run it against a live instance.
- The deployment troubleshooting guide uses `docker compose config
  --no-interpolate`; the plain form printed every resolved secret from `.env`
  to stdout.

### Changed

- **Breaking: the operator `OPENAI_API_KEY` is gone.** It is no longer read by
  the backend or passed through `docker-compose.yml`. Existing users are
  migrated to an `openai` connection pre-filled with their previous default
  model but **without** a key — the operator's shared credential is
  deliberately not copied into user rows. Until each user adds their own key,
  AI features show a "Connect a provider in Settings" notice instead of
  failing at call time. Remove `OPENAI_API_KEY` from your `.env` after
  upgrading.
- **Breaking:** `GET /api/prompts/config` now requires authentication and
  reports the calling user's own connection. `openai_available` is replaced by
  `provider_connected`, plus `provider`, `provider_label`, and `model`.
- **Breaking:** `default_model` is removed from `GET`/`PATCH /api/auth/me`.
  The model is part of the provider connection now; a second, separately
  validated model preference had no coherent meaning.
- Spend ceilings (`GLOBAL_MONTHLY_BUDGET_USD`, `USER_MONTHLY_BUDGET_USD`) keep
  working but change meaning: users pay their own provider, so these are usage
  guard rails rather than protection for an operator wallet. Self-hosted
  providers price at 0.0, so ceilings never bind for them.
- Cost tracking is keyed by `(provider, model)`; `billed_calls` rows record the
  provider. Unknown pairs still cost 0.0 rather than raising.
- Structured-output handling is now portable. `response_format` is not honoured
  consistently across OpenAI-compatible endpoints (Anthropic documents it as
  silently ignored), so the JSON schema travels in the prompt for every
  provider, `response_format` is layered on only where it helps, and responses
  are parsed tolerantly with one bounded retry.
- Judge grading uses the user's own connection rather than a pinned model, so
  eval scores are not comparable across users with different providers.
- The per-case evaluation timeout derives from the provider's request timeout
  instead of a fixed 90 seconds, so self-hosted runs are not cut short.
- Provider errors are reported with provider-neutral copy naming the user's own
  provider, replacing OpenAI-branded messages like "OpenAI quota exceeded".
- Application version metadata reports `0.1.0`, matching this changelog. The
  Python and npm manifests and the FastAPI app previously advertised `1.0.0`.
- `DATABASE_URL` is documented as applying to non-Docker local runs only.
  `docker-compose.yml` continues to hardcode the container path on purpose:
  the variable's local value is a relative path, which inside the container
  lands outside the persistent volume and starts the backend on an empty
  database.
- Python dependencies are locked transitively in `backend/requirements.lock`;
  local, CI, and container installs all consume it.
- `THIRD_PARTY_NOTICES.md` inventories the resolved runtime dependency sets,
  and both container images carry it alongside the project `LICENSE` and
  `NOTICE`.

### Fixed

- JWT validation now permits at most five seconds of host-clock skew, preventing
  freshly issued sessions from being rejected during a small NTP clock
  correction while keeping issue-time and expiry validation bounded.
- Editor no longer rejects rapid successive edits in a single session with a
  spurious 409 conflict. Prompt mutations are serialized and each one now
  carries the concurrency token from the previous response, so back-to-back
  variable/tag edits both persist. Genuine cross-session conflicts still 409,
  and the conflict banner now offers the Reload action it names instead of
  silently reverting the rejected edit.
- Saving on `/editor/new` regenerates the template when fields changed after
  the last Generate, instead of persisting the stale preview and discarding
  the edit. The preview is also marked stale in the meantime.
- Duplicate field-name validation is case-insensitive, matching the
  upper-cased XML tags the generator emits — `QA_dup` and `qa_DUP` are now
  blocked before submit.
- A Boolean variable left in its default off position counts as `false`
  rather than "missing", and preflight's missing-value check no longer
  disables the Playground's Run button — preflight is advisory everywhere.
- The exported TypeScript snippet uses `replaceAll`, so a variable used more
  than once in a template is substituted at every occurrence.
- The snapshot auto-created when an AI refinement is accepted is labelled
  "Before AI refinement" in version history; historical versions are now
  labelled by their own note rather than the following version's.
- Accepted AI-generated eval cases get a short generated case name instead of
  a mid-word truncation of the proposal's rationale.

### Initial feature set

#### Prompt authoring
- Dynamic field composition — build a prompt from named fields, compiled into
  an XML-tagged template block (`<GOAL>…</GOAL>`).
- Starter kits for common structures: Role–Task–Context, Chain-of-Thought,
  and Persona.
- AI-powered import — paste free-form text and have the connected provider
  decompose it into structured fields.
- Editor with direct template editing, variable metadata and type
  configuration, and version compare/restore.
- Preflight checks flagging unresolved variables, malformed XML, empty
  sections, stale metadata, and oversized prompts.
- Export of Python and TypeScript integration snippets.

#### Running and evaluating
- Playground for executing saved prompts with the user's connected provider
  and selected model, with latency, token count, and cost breakdown.
- Paginated run history with input replay.
- Evaluation suite supporting rule-based, AI-judge, and manual test cases,
  CSV dataset import/export, AI-generated reviewable cases, and cross-version
  output comparison.
- AI refinement flow — clarifying questions, word-level diffs of proposed
  revisions, and acceptance as reversible new versions.

#### Organization
- Library with grid and list views, search, tag filtering, folder
  organization, favoriting, and rename/duplicate/delete.
- Dashboard with usage analytics computed from real runtime data: runs this
  month, average latency, success rate, 7-day request volume, and top prompts.
- Separate paginated, searchable History tab.

#### Accounts and settings
- JWT authentication with registration, login, and sliding session renewal.
- All prompt data scoped per user.
- Password reset over SMTP, with cron-invoked weekly summary emails.
- Settings for profile, UI theme, layout density, evaluation defaults,
  automated evaluation triggers, email notification toggles, and full JSON
  data export.

#### Operations
- Docker Compose deployment behind Caddy with automatic TLS. Caddy is the
  production edge and is excluded from the local development stack, so
  `make up` does not claim host :80/:443 or attempt ACME against a placeholder
  domain; opt in locally with `docker compose --profile caddy up -d`.
- Prometheus and Grafana monitoring stack.
- SQLite persistence with an idempotent migration runner and optional
  automated backup worker.
- Cost guardrails — optional global and per-user monthly spend ceilings
  (`GLOBAL_MONTHLY_BUDGET_USD`, `USER_MONTHLY_BUDGET_USD`) limiting the
  estimated provider usage driven through the application.
- Rate limiting on registration, with trusted-proxy handling for
  `X-Forwarded-For`.
- Token-protected operator SMTP diagnostics endpoint.

#### Project and release infrastructure
- Apache-2.0 `LICENSE` and `NOTICE`, plus a runtime-specific
  `THIRD_PARTY_NOTICES.md` included in each published image.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), and
  `SECURITY.md` with a private disclosure process.
- GitHub issue templates (bug, feature), pull request template, `CODEOWNERS`,
  and Dependabot configuration.
- CI pipeline enforcing Ruff lint and format, Bandit, pip-audit, pytest with a
  90% coverage gate, CodeQL static analysis of the TypeScript sources,
  TypeScript type checking, ESLint, npm audit, Next.js production build, Vitest
  with enforced coverage floors, Playwright browser E2E tests, Docker image
  build and smoke tests, and Compose config validation.

### Known limitations

- Output quality and compatibility depend on the user-selected provider and model.
- SQLite only; no PostgreSQL support.
- No multi-tenant organization or team features.
- No published upgrade path between `0.x` releases — expect breaking changes.

[Unreleased]: https://github.com/chrysogonus/prompt-maker-studio/commits/main
