# Product Roadmap

> Reviewed against the codebase: 2026-10-17. Latest published release: 0.6.0.

## Now — Current Sprint / Active Development
- [ ] **Deployment rehearsal and approval** — Release publication does not establish production deployment. Rehearse forward-only migrations on an isolated production-backup copy before upgrading older installations; approve deployment separately. See [deployment](../docs/deployment.md).

## Next — Coming Soon (next 1–2 sprints)
- [ ] **Recovered history cleanup** — Let users select several prompts, or find duplicates, to tidy "Recovered history" (see BACKLOG "Bulk Prompt Delete")
- [ ] **Extend refinement controls** — Questions, section diffs and local Apply/Undo are restored in the editor. Direct change instructions and individual section acceptance remain open

## Later — Quarterly Horizon
- [ ] **Calibrate evaluation scores** — Users can now rate AI-reviewed outputs and see the agreement rate; show it wherever AI-review scores are compared
- [ ] **Markdown heading output option** — Plain-text copy is implemented; rendering named section headings remains open
- [ ] **Version milestones** — Pin and label important versions (notes on save shipped in 0.3.0)
- [ ] **Prompt trash and restore** — A 30-day recovery window for deleted prompts and their history
- [ ] **Full-fidelity backup restore through the UI** — Basic collection import is implemented; historical records and original dates remain out of scope

## Someday / Aspirational
- [ ] **Prompt sharing** — Read-only links to publish a template
- [ ] **Team workspaces** — Shared libraries for small teams
- [ ] **Nested or empty folders** — Needs a folders table instead of the label on `prompts`

## Completed and Historical Delivery

Dates below record original delivery. Notes identify later replacements; they
are not a list of current controls. The current inventory is [FEATURES.md](FEATURES.md).
| Item | Completed | Notes |
|---|---|---|
| 0.6.0 release | 2026-10-17 | Published: curated AI models, optional Anthropic workspace; Responsive/focused editor, non-AI capture, retained filled inputs, collection import preview, batch filing, title/content-recency sorting, budget recovery and sidebar/system theme |
| 0.5.1 release | 2026-10-16 | Published: shared light/dark layout, saved theme before first paint, Tools menu, Test with AI panel, responsive library cards, keyboard focus restoration and synchronized documentation; [release record](../docs/releases/0.5.1.md) |
| 0.5.0 release | 2026-10-15 | Published: application observability, immutable auth/OAuth identities, account/session hardening, public guides, provider/billing/backup reliability and dependency updates; [release record](../docs/releases/0.5.0.md) |
| 0.4.0 release | 2026-10-14 | Published: public landing page, request-time SEO metadata, packaged public assets and MCP Registry descriptor; [release record](../docs/releases/0.4.0.md) |
| 0.3.0 release | 2026-10-13 | Published: sections editor, library redesign, recovered history, version notes, pasted-prompt conversion, refinement, evaluation and Try once; [release record](../docs/releases/0.3.0.md) |
| Repository refactoring | 2026-10-11 | Completed shared prompt/account services, domain schemas, migration modules and frontend feature/API boundaries; [historical record](../docs/refactoring.md) |
| Evaluation workspace restored | 2026-10-12 | Saved-prompt Evaluate action; plain-language case editing, CSV import/export, reviewed AI suggestions, explicit runs, historical outputs, comparison and manual ratings. Existing backend API unchanged; automatic runs stay disabled |
| 0.3.0 redesign | 2026-10-11 | One sections editor for new and saved prompts with live fill-and-copy preview and a version History panel; sections became the only thing clients write (migration 023 recovers edited text); library home with sidebar folders, bulk folder rename/remove, and Recovered history (migration 024); coral-and-plum visual system; retired Generate/History, dashboard, Playground, tags, snippets, notifications and density; Refine and Evaluate were initially deferred and restored before 0.3.0 publication. Rows below record historical delivery; retired/superseded behavior is identified explicitly |
| User registration & JWT auth | Pre-baseline | Full register/login/me flow with bcrypt and JWT |
| Dynamic field editor | Pre-baseline | Add/remove fields, validated before submit |
| XML prompt generation | Pre-baseline | Generates structured XML; persisted per user |
| AI text import (parse-text) | Pre-baseline | LLM-backed parse of free-form text into fields; now runs through the user's provider connection |
| Server-side prompt history | Pre-baseline | Per-user history with ownership enforcement |
| Prompt duplication | Pre-baseline | Duplicate owned prompts via API |
| Copy-to-clipboard | Pre-baseline | One-click copy of generated output |
| Dark/light theme | Pre-baseline | Toggleable theme with CSS design tokens |
| Rate limiting | Pre-baseline | SlowAPI limits on auth and prompt endpoints |
| Docker + Caddy | Pre-baseline | Containerized deployment with reverse proxy |
| Test suite + security tooling | Pre-baseline | pytest, Bandit, pip-audit, npm audit, Ruff, and ESLint |
| Server-side saved prompts | 2026-06-30 | Named prompts stored in DB via `name` column; loaded from `/api/prompts/saved`; accessible across devices |
| Password reset / account recovery | 2026-06-30 | Email-based reset: forgot-password + reset-password endpoints; 1-hour token; single-use |
| Account deletion | 2026-06-30 | `DELETE /api/auth/me`; cascades all owned prompts; frontend confirmation banner |
| Input validation hardening | 2026-06-30 | XML-safe field name pattern; max lengths on content, parse-text input, and generated_prompt |
| Frontend test suite | 2026-06-30 | Vitest + React Testing Library; AuthForm login/register/forgot-password tests |
| Browser end-to-end test suite | 2026-07-11 | Playwright Chromium runs core registration, prompt generation, saved-prompt persistence, and unavailable AI-import journeys against isolated Compose services |
| Grafana dashboard provisioning | 2026-06-30 | Auto-provisioned dashboard: request rate, latency (p50/p95/p99), error rate, rate-limit metrics |
| Automatic database migrations | 2026-07-05 | Lightweight migration runner applying pending SQLite database schema changes on startup |
| SQLite backup & restore CLI scripts | 2026-07-05 | Standalone Python CLI scripts for consistent database backup/restore with integrity checking |
| Prometheus metrics instrumentation | 2026-07-05 | FastAPI application instrumentation to export HTTP metrics for Prometheus scraping |
| Prompt History UI & Sidebar Integration | 2026-07-05 | Tabbed sidebar UI for browsing, selecting, duplicating, and deleting recent prompt generations Retired in 0.3.0. |
| Real-time Field Name Sanitization | 2026-07-05 | Auto-sanitization of spaces/special chars in field names to prevent validation failures; blocks duplicate field names Retired in 0.3.0. |
| Auto-Save Drafts in Editor | 2026-07-05 | Persistent localStorage caching of active prompt dynamic fields to prevent loss of work |
| Prompt Variable Injection Panel | 2026-07-05 | Dynamic UI panel to substitute placeholder variables (e.g. `{{var}}`) inside generated prompts before copying |
| SMTP Configuration Diagnostics | 2026-07-05 | Token-protected operator API route to check SMTP connectivity health in real-time |
| OpenAI model pin documentation | 2026-07-06 | `gpt-4.1-mini-2025-04-14` pin confirmed as intentional; recorded in DECISIONS.md. Superseded 2026-07-26 — the model is now a per-user connection setting |
| Syntax-highlighted XML code viewer | 2026-07-06 | Line-numbered code view with XML tag/punctuation syntax highlighting in the output panel Retired in 0.3.0. |
| Animated compile reveal | 2026-07-06 | Staggered block-reveal animation on Update to signal prompt recompilation Retired in 0.3.0. |
| Copy button visual feedback | 2026-07-06 | "Copied" confirmation; current default theme is light, with a saved dark preference respected before first paint |
| Keyboard shortcut (Ctrl/Cmd+Enter) | 2026-07-06 | Generate fires on Ctrl+Enter / ⌘↵; shortcut hint in button title Retired in 0.3.0. |
| Sidebar client-side search | 2026-07-06 | Instant filter on name, fields, and generated text; filtered/total count badge |
| Prompt output metrics | 2026-07-06 | Character count, word count, estimated token count (~chars/4) above the code view Retired in 0.3.0. |
| Collapsible AI import panel | 2026-07-06 | Collapsed by default; toggle persisted to localStorage Retired in 0.3.0. |
| Username change | 2026-07-06 | Inline username edit in header; uniqueness enforced; since 0.5.0 immutable account subjects let the session continue after rename |
| `updated_at` on prompts (migration 005) | 2026-07-06 | DATETIME column backfilled from created_at; set on every PATCH; surfaces in sidebar date labels |
| Prompt history pagination & search | 2026-07-10 | `offset` + `search` added to `GET /api/prompts/history`; sidebar History tab gets a debounced server-side search and a "Load more" button Retired in 0.3.0. |
| Inline rename of saved prompts | 2026-07-10 | Pencil icon on Saved-tab items commits a name-only `PATCH` without loading the prompt into the editor Current library rename is in the prompt action menu; the Saved tab/pencil UI was replaced. |
| Interactive field re-ordering | 2026-07-10 | Up/down arrows on each field in the input panel swap positions instantly |
| Authenticated password change | 2026-07-10 | `POST /api/auth/change-password`; verifies current password; no forced re-login (JWT subject unaffected) |
| AI import capability check | 2026-07-10 | `GET /api/prompts/config`; PromptImporter proactively disables itself with a visible notice when AI isn't available, instead of failing only after a user tries. Became authenticated and per-user with bring-your-own providers (2026-07-26) |
| Operator business metrics | 2026-07-10 | Original business counters and dashboard row; replaced in 0.5.0 by `pms_*` operation/provider/evaluation metrics and three dashboards |
| Application UI redesign | 2026-07-12 | New design system and a routed multi-page IA (Dashboard/Library/Editor/Playground/Settings) replacing the single-page app; new shared UI primitives layer |
| Prompt tagging and categorization | 2026-07-12 | User-defined tags (JSON column) with distinct-tag listing and Library filtering Retired in 0.3.0. |
| Prompt folders | 2026-07-12 | Free-text organizational label with distinct-folder listing |
| Favorites | 2026-07-12 | Star/unstar a prompt; current Favorites view is in the library sidebar (Dashboard retired in 0.3.0) |
| Prompt versioning | 2026-07-12 | Automatic snapshot on every content edit to a saved prompt; full restore (itself undoable) |
| In-app prompt testing (Playground) | 2026-07-12 | Real model execution against a user-selected model with `{{variable}}` substitution; latency/token/cost tracking; rate-limited. Originally used the operator's `OPENAI_API_KEY`; now runs on each user's own provider connection (2026-07-26) — see `product/DECISIONS.md` Retired in 0.3.0. |
| Dashboard usage analytics | 2026-07-12 | Runs this month, average latency, success rate, 7-day request volume, and top prompts by usage — computed from real data, never fabricated Retired in 0.3.0. |
| Export saved prompts as JSON | 2026-07-12 | Full data export including version history, from Settings → Data |
| Settings preferences | 2026-07-12 | Original theme/density/notification controls; density and notification UI/delivery retired in 0.3.0. Current Settings includes theme, library layout, AI connection, account and data controls |
| Weekly summary email delivery | 2026-07-13 | Cron-invoked script aggregates week stats and emails opted-in users Retired in 0.3.0. |
| Per-variable descriptions & types | 2026-07-13 | Variables panel shows persisted type and description per variable. Current editor edits hints, required flags and examples; legacy types remain stored but are no longer editable. |
| AI Prompt Refinement | 2026-07-13 | Clarifying questions and AI-generated draft revisions UI initially deferred during the redesign; restored before 0.3.0 publication. |
| Prompt Evaluation (Eval Set) | 2026-07-13 | Test cases (rule/judge/manual), bulk execution, and run history with per-case scores UI initially deferred during the redesign; restored before 0.3.0 publication. |
| Eval dataset CSV import/export | 2026-07-13 | Atomic CSV import and export for eval cases and per-case variables UI initially deferred during the redesign; restored before 0.3.0 publication. |
| Visual version comparison | 2026-07-13 | Word-level comparison of a historical snapshot against the current saved prompt |
| Playground cost analytics | 2026-07-13 | Total and average cost-per-run metrics on the Dashboard Retired in 0.3.0. |
| Evaluation workflow preferences & notifications | 2026-07-14 | Library layout preference remains active; eval defaults and auto-run flags are stored but inactive, and notification delivery was retired in 0.3.0. Evaluations run only on explicit action. |
| Field templates / starter kits | 2026-07-16 | Curated field presets ("Role-Task-Context", "Chain-of-Thought", "Persona") loadable from the field editor as a starting point Current starters are Role, task, format; Rewrite my text; Summarise something; Persona. Chain-of-Thought was replaced. |
| Template vs compiled copy toggle | 2026-07-16 | Original Output Panel retired in 0.3.0; the current editor preview offers Template/Filled copy controls. |
| Legacy-account email recovery reminder | 2026-07-16 | Dismissible post-login banner for null-email accounts, linking to the Settings email editor |
| Code snippet export | 2026-07-16 | Editor Detail generates ready-to-run Python/TypeScript OpenAI client snippets from a saved prompt's compiled template and variables Retired in 0.3.0. |
| Playground run history & replay | 2026-07-17 | Paginated `GET /api/prompts/{id}/playground/runs`; history drawer in the Playground loads a prior run's model/inputs back into the form; re-running always inserts a new row Retired in 0.3.0. |
| Reproducible evaluation run metadata | 2026-07-17 | `EvalRun` persists resolved model + aggregated latency/tokens/cost (migration 015); `EvalRunResult` snapshots each case's criteria/variables and the judge model actually used, surfaced in the Evaluate tab's run history UI initially deferred during the redesign; restored before 0.3.0 publication. |
| API spend budgets & guardrails | 2026-07-17 | Optional `GLOBAL_MONTHLY_BUDGET_USD`/`USER_MONTHLY_BUDGET_USD` env-configured monthly ceilings, enforced before metered AI operations; surfaced via `GET /api/prompts/config` and disabled billed actions in the current editor/evaluation UI (standalone Playground retired) |
| Evaluation Failure Inspector & Run Comparison | 2026-07-17 | Current Run history selects a run with per-case outputs, criteria, scores and feedback; Compare with selects another run and aligns saved case identities, with changed-condition/model warnings. Original Compare checkboxes and run-level latency/token/cost deltas were not restored. |
| AI-Assisted Eval Set Generator | 2026-07-17 | `POST /api/prompts/{id}/eval/cases/generate` proposes happy-path/edge-case/adversarial eval cases from the current template and variable metadata; current suggestions open through Review and add and persist only on Save test case; Discard suggestions clears unsaved proposals. UI restored before 0.3.0 publication. |
| Prompt Preflight & Readiness Checks | 2026-07-17 | Advisory `PreflightPanel` surfaces unresolved placeholders, unbalanced XML, empty sections, stale variable metadata, and large-prompt warnings at the copy, Playground, and Evaluate entry points; never blocks the action Retired in 0.3.0. |
| Accessibility e2e checks | 2026-07-17 | Axe-based Playwright specs assert no serious a11y violations on the login page and authenticated pages, in dark and light themes |
| Editable Refine drafts & zero-question handling | 2026-07-17 | AI-drafted revisions can be edited in place before accepting; a well-specified prompt yielding no clarifying questions gets an explicit message instead of an empty form UI initially deferred during the redesign; restored before 0.3.0 publication. |
| Rule criteria prefix operators | 2026-07-18 | `!term` (not-contains), `~pattern` (regex), and `{json}` (valid JSON) rule assertions with bracket-aware, escape-safe splitting; plain substring criteria unchanged — partially delivers the "Rich Deterministic Eval Assertions" backlog item UI initially deferred during the redesign; restored before 0.3.0 publication. |
| Structured judge feedback with prompt context | 2026-07-18 | Judge returns strict-schema score/strengths/weaknesses/rationale JSON, sees the compiled prompt as grading context (char-capped), and judge API/parse failures are captured per-case instead of aborting the run UI initially deferred during the redesign; restored before 0.3.0 publication. |
| Eval diagnostics & guidance UX | 2026-07-18 | Original diagnostics UI was replaced during the redesign. Current evaluation uses plain-language method labels, score/status feedback and explicit runs; the per-method card breakdown, Debug in Playground action and post-update evaluation nudge were not restored. |
| Unified AI spend ledger | 2026-07-18 | `billed_calls` table (migration 016) written by metered product workflow call paths; budget ceilings and the Dashboard total now read it; migration 019 adds provider attribution; no backfill — ledger history starts at deploy. The ledger remains active; the product Dashboard was retired in 0.3.0. |
| Parallel, timeout-safe evaluation execution | 2026-07-18 | Eval cases fan out across a five-worker thread pool with one batch budget pre-check. Provider I/O timeouts bound calls; the separate future deadline was removed to retain completed usage. Workers settle before request-thread persistence, with results in case order. |
| UX audit reliability and recovery pass | 2026-07-18 | ID-keyed delete/proposal state, delayed delete undo, deep prompt duplication, visible filter counts, explainable history search, terminal loader/404 states, semantic headings/status regions, real navigation links, session-expiry messaging, and local recovery for saved-editor and refinement drafts. Current editor drafts persist in browser storage; refinement sessions are in memory and do not survive navigation/reload. |
| Sliding session renewal | 2026-07-19 | Authenticated `POST /api/auth/refresh` plus client-side sliding renewal: cached/deduped `/api/auth/me`, single-flight refresh, pre-renewal before long operations, one retry after a 401 — closes the "Graceful Session Expiry & Sliding Token Refresh" backlog item |
| Optimistic concurrency control | 2026-07-19 | Prompt updates carry `last_updated_at`; a concurrently-modified prompt returns 409 instead of being silently overwritten |
| Responsive mobile navigation | 2026-07-19 | Nav bar collapses to a hamburger menu on narrow viewports; content pages remain desktop-first Retired in 0.3.0. |
| Editor draft-recovery follow-ups & action confirmations | 2026-07-19 | Leave-page confirmation on unsaved changes, restored-draft banner with discard, "Changes saved."/"Version restored." status banners, Library rename toast — completed the original backlog item. The current editor restores browser drafts with a discard option and does not show a leave-page confirmation. |
| UI/UX audit hardening (phases 1–3) | 2026-07-19 | Reliability and polish across delete confirmation, per-prompt eval-history scoping, post-run 401 race elimination, failed-run replay error surfacing, save-dialog character count, WCAG AA contrast, and accessibility labeling |
| Pre-launch audit fixes (PM-01..PM-10) | 2026-07-19 | Keepalive delete-flush on `pagehide` so refresh/tab-close can't resurrect a prompt mid-undo; session re-validated on bfcache restore (`pageshow`/`visibilitychange`) plus `Cache-Control: no-store` so Back after sign-out can't redisplay account data; client-side (`noValidate`) form validation with inline `role="alert"` errors and trimmed usernames across auth/settings forms; password show/hide toggle; single-update filter clearing in the Library; Library search now also matches prompt body text; `<h2>` card/list titles for heading order |
| Pre-launch audit verified findings (H-1, M-1, L-1, L-2) | 2026-07-19 | Reverted XML-entity-escaping of prompt field content (was corrupting saved/compiled/copied/exported text containing `&`, `<`, `>` — see `product/DECISIONS.md`); backend prompt-name cap tightened from 255 to 100 to match the UI, with ellipsis+tooltip truncation in card/list titles and the editor breadcrumb/header; friendly client-side password-length message on the change-password form; non-blocking duplicate-name warning on rename |
| Named eval cases & stable prompt IDs | 2026-07-19 | Eval cases persist explicit names and intentionally-empty semantics (migration 017); SQLite prompt allocation uses a high-water mark so deleted IDs are never reused in durable URLs (migration 018) |
| Go-live production hardening | 2026-07-24 | Explicit process environment is validated at startup, account-name validation is enforced at backend boundaries, provider clients have bounded timeouts, the migration 015 reference file is present, and targeted auth coverage was added |
| 0.1.0 release infrastructure | 2026-07-27 | Apache-2.0 source and image licensing, security/contribution/conduct guidance, changelog, issue and PR templates, CODEOWNERS, dependency automation, and CI/release documentation |
| Animated authentication experience | 2026-07-25 | Responsive login/register/recovery experience gains ambient motion, staged reveals, view transitions, action feedback, and reduced-motion support Retired in 0.3.0. |
| Bring-your-own LLM provider connections | 2026-07-26 | Each user can connect OpenAI, Anthropic, Gemini, Ollama, vLLM, or a custom OpenAI-compatible endpoint; credentials are encrypted at rest, every AI feature shares one provider-aware client path, JSON output is portable across compatibility levels, and spend is attributed by provider/model (migration 019) |
