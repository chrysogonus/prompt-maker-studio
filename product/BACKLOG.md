# Product Backlog

> Items here are **NOT yet implemented**. See FEATURES.md for what is built.
> Sorted by priority within each category.
> Last reviewed against the codebase: 2026-07-26.

---

## Priority: High

_The prior High-priority batch (Evaluation Failure Inspector & Run Comparison, AI-Assisted Eval Set Generator, and Prompt Preflight & Readiness Checks) shipped 2026-07-17. Both High-priority proposals from the 2026-07-18 gap scan — Async, Parallel, Timeout-Safe Evaluation Execution and the Unified AI Spend Ledger — shipped later that same day (thread-pool fan-out with per-case timeouts, and the `billed_calls` ledger via migration 016). See `product/FEATURES.md` and `product/ROADMAP.md`. No open High-priority items._

---

## Priority: Medium

### Evaluation-Informed Refinement
- **Value**: Riley gets refinement that fixes *observed* failures instead of generic improvements — closing the product's core loop (test → understand → refine) that currently runs as two disconnected features.
- **Gap identified**: `prompt_refiner.py` sees only the template and the user's Q&A answers; it has no awareness of eval results, even though `EvalRunResult` rows carry failing outputs, criteria, and structured Judge weaknesses for the same prompt.
- **Suggested approach**: Optionally include the latest run's low-scoring results (case label, criteria, output excerpt, judge weaknesses) in the refine draft call's context, behind a toggle in the Refine tab ("Use latest evaluation results"). Char-cap the context like the Judge call does.
- **Effort estimate**: Medium
- **Priority recommendation**: Nice-to-have

### Eval Health on Library Cards & Dashboard
- **Value**: Riley can see at a glance which templates are tested, passing, or stale — today evaluation results are invisible outside the Evaluate tab, so a library of 30 prompts gives no signal about which are trustworthy.
- **Gap identified**: The Library page contains zero references to eval data. `EvalRun.prompt_version_number` already records which version a run scored, so "evaluated against an older version" (stale) is directly computable.
- **Suggested approach**: A small badge per saved prompt — latest aggregate score, "stale" when the current version has no run, "untested" when no cases exist — via a grouped query like the existing `run_counts_by_prompt_ids` pattern; optionally a Dashboard "eval coverage" stat.
- **Effort estimate**: Low
- **Priority recommendation**: Nice-to-have

_"Graceful Session Expiry & Sliding Token Refresh" shipped 2026-07-19 exactly as proposed: an authenticated `POST /api/auth/refresh` with client-side sliding renewal (`ensureSessionValidity` before long operations, shared single-flight refresh, one retry after a 401). Full refresh-token rotation remains unimplemented and would be a new backlog item if security posture demands it — see `product/FEATURES.md` ("Sliding session renewal")._

### First-Run Onboarding With a Seeded Sample Prompt
- **Value**: Jordan lands in an empty workspace where every advanced feature (eval, refine, Playground) needs a saved prompt to even be visible; a pre-seeded example makes the product self-demonstrating and shortens time-to-first-value.
- **Gap identified**: `backend/scripts/seed_demo_user.py` already builds exactly this data shape for QA, but nothing equivalent exists for real new users; registration creates a bare account.
- **Suggested approach**: On registration, create one well-commented sample prompt with variables, tags, and 2–3 eval cases (a trimmed reuse of the seed script's builders), plus a dismissible "start here" pointer. Purely additive — deletable like any prompt.
- **Effort estimate**: Low
- **Priority recommendation**: Nice-to-have

### Eval Run Results Export (CSV)
- **Value**: Riley can analyze evaluation results in a spreadsheet or share them outside the app — today eval *cases* round-trip via CSV but run *results* (outputs, scores, rationales) are locked in the UI.
- **Gap identified**: `eval_routes.py` exports cases only; `EvalRunResult` rows (including snapshotted criteria/variables and structured judge feedback) have no export path.
- **Suggested approach**: `GET /api/prompts/{id}/eval/runs/{run_id}/export` mirroring the existing case-export CSV conventions, one row per result with score, method, criteria snapshot, output, and rationale fields.
- **Effort estimate**: Low
- **Priority recommendation**: Nice-to-have

### Evaluation Progress, Cancellation & Partial Results
- **Value**: Users running larger or Judge-based eval sets can see useful progress, stop unnecessary spend, and retain results already completed instead of waiting behind a single opaque request.
- **Gap identified**: Eval cases now run in parallel with per-case timeouts (shipped 2026-07-18), but the run is still one synchronous API request while the UI shows only a generic "Running…" state — there is no per-case progress, no cancellation, and a failure before commit still discards the in-progress run (`backend/app/services/eval_service.py`, `backend/app/api/eval_routes.py`, `frontend/src/components/editor/EvaluateTab.tsx`).
- **Suggested approach**: Represent an evaluation as a persistent job with queued/running/completed/cancelled status and per-case progress. Let users cancel the remaining cases, preserve completed results and incurred usage, and resume UI polling after navigation or reload.
- **Effort estimate**: High
- **Priority recommendation**: Nice-to-have

_"Saved-Editor Draft Recovery" completed 2026-07-19: the remaining follow-ups (leave-page confirmation on unsaved changes, and a visible "Unsaved draft — restored from this device" banner with a discard action) shipped on top of the 2026-07-18 core recovery — see `product/FEATURES.md` ("Action confirmations & unsaved-changes guard")._

### Version Notes & Milestones
- **Value**: Riley can record why a revision was made and identify important snapshots such as "production", "experiment", or "known good" without relying on version numbers alone.
- **Gap identified**: The update API and version model already support an optional note, and version history displays it, but normal editor updates never ask for or send a user-authored note (`backend/app/models/schemas.py`, `backend/app/models/prompt_version.py`, `frontend/src/components/EditorDetail.tsx`, `frontend/src/components/editor/ConfigurationTab.tsx`).
- **Suggested approach**: Add an optional change-note field to the update flow and let users mark a version as a named milestone. Show notes and milestone labels consistently in version history, evaluation history, and restore confirmation.
- **Effort estimate**: Low
- **Priority recommendation**: Nice-to-have

### Prompt Trash & Restore
- **Value**: Users can recover a prompt deleted by mistake without asking an operator to restore the entire database, protecting the versions, evaluations, and Playground evidence accumulated around valuable templates.
- **Gap identified**: Prompt deletion is immediate and cascades through owned versions and evaluation data; the frontend offers no user-visible recovery state (`backend/app/api/routes.py`, `backend/app/models/prompt.py`, `frontend/src/app/(app)/library/page.tsx`).
- **Suggested approach**: Soft-delete prompts into a Trash view for 30 days, with restore and explicit permanent-delete actions. Exclude trashed prompts from normal library, dashboard, and execution queries while retaining their dependent records until final deletion.
- **Effort estimate**: Medium
- **Priority recommendation**: Must-have

### Custom Eval Judges
- **Value**: The current "Judge" eval method uses a hardcoded rubric prompt and reuses the user's own connection model. Power users need to define their own grading rubrics or use more powerful models (`gpt-4o`) to score complex outputs accurately.
- **Gap identified**: `eval_service.py` hardcodes `_JUDGE_SYSTEM_PROMPT`, and grading always runs on the same connection as the case itself, so there is no way to grade with a stronger model than the one under test. (The judge's *output* became structured — score/strengths/weaknesses/rationale JSON with the compiled prompt as context, shipped 2026-07-18 — but the rubric and model remain fixed.)
- **Suggested approach**: Add an "Advanced Judge Settings" section in the Evaluate tab to override the default system prompt and model used for grading.
- **Effort estimate**: Medium
- **Priority recommendation**: Nice-to-have

### Variable Contracts, Defaults & Required Inputs
- **Value**: Prompt authors can define a dependable input contract, while Playground users and generated code receive useful defaults and cannot accidentally run a prompt with required placeholders unresolved.
- **Gap identified**: `variable_metadata` persists only `type` and `description`. Both prompt compilers leave an unmatched placeholder untouched, and the Playground permits a run without checking that all detected variables have values.
- **Suggested approach**: Extend variable metadata with `required`, `default_value`, and optional validation constraints appropriate to each type. Apply the same contract in the Playground, code-snippet export, and backend compilation boundary.
- **Effort estimate**: Medium
- **Priority recommendation**: Nice-to-have

### Scalable Library Search, Sort & Folder Filtering
- **Value**: Users with a large personal library can find prompts by name, content, tag, folder, favorite status, or recency without downloading and filtering the entire collection in the browser.
- **Gap identified**: `GET /api/prompts/saved` returns every named prompt and supports tag/folder/favorite filters, but the Library uses only the tag filter, performs text search client-side, exposes no folder control, and always orders by creation date.
- **Suggested approach**: Add server-side `search`, `limit`, `offset`, and validated sort parameters to the saved-prompts endpoint. Wire folder/favorite filters and sorting into the Library with paginated or incremental loading and a total count.
- **Effort estimate**: Medium
- **Priority recommendation**: Nice-to-have

### Evaluation Baselines & Regression Gates
- **Value**: Riley can designate a known-good result and see a clear pass/fail regression signal before accepting a prompt revision, instead of interpreting a list of raw historical scores manually.
- **Gap identified**: Eval history displays scores by prompt version and notifications compare with the previous scored run, but there is no selected baseline, acceptable-drop threshold, or editor gate tied to the evaluation result.
- **Suggested approach**: Let users mark an eval run as the baseline and configure a minimum score or maximum allowed decline. Show per-case and aggregate deltas, and warn before accepting an AI refinement or update that fails the gate without preventing an explicit override.
- **Effort estimate**: Medium
- **Priority recommendation**: Nice-to-have

### Playground Generation Controls & Presets
- **Value**: Developers can test the same prompt under realistic generation settings and save repeatable configurations for deterministic or creative use cases.
- **Gap identified**: `PlaygroundRunRequest` accepts only `model` and variables, while `PlaygroundService` sends no temperature, maximum-output-token, or related generation controls to the connected provider and does not persist such settings with a run.
- **Suggested approach**: Add a small advanced panel for supported controls, validated per model, with safe defaults and named presets. Persist the resolved settings on each Playground run and reuse them when replaying a run.
- **Effort estimate**: Medium
- **Priority recommendation**: Nice-to-have

### Rich Deterministic Eval Assertions — Remaining Scope (JSON-path & typed checks)
- **Status note**: The core of this item shipped 2026-07-18 as rule criteria prefix operators — contains (default), `!` not-contains, `~` regex, and `{json}` valid-JSON checks with bracket-aware splitting (see `product/FEATURES.md`). What remains below is the unshipped tail.
- **Value**: Developers can verify values *inside* structured outputs — a JSON-path pointing at an expected value, or a numeric range check — without paying for an AI judge.
- **Gap identified**: `eval_service.py` can now assert an output is valid JSON but cannot inspect its contents; there is no numeric-range assertion, and failures report which term missed but not a richer structured explanation.
- **Suggested approach**: Add JSON-path value checks (e.g. `$.result.status == "ok"`) and numeric-range assertions as further prefix operators or a structured assertion config; keep existing criteria backward compatible.
- **Effort estimate**: Medium
- **Priority recommendation**: Nice-to-have

### Prompt Branching (Non-Linear Versioning)
- **Value**: Users often want to explore two different styles of a prompt simultaneously and run evals on both to see which performs better, without overwriting their main prompt's history.
- **Gap identified**: Duplicating a prompt creates a completely separate entity with no lineage linking it to the original. Version history is strictly linear.
- **Suggested approach**: Add a `parent_prompt_id` column to the `prompts` table. When duplicating, record the parent. Add a visual tree/branch indicator in the UI.
- **Effort estimate**: High
- **Priority recommendation**: Future

### Prompt Output Format Selection (System vs User Messages)
- **Value**: The current system flattens all fields into a single XML block. Most LLMs distinguish between System (instructions) and User (data) messages.
- **Gap identified**: `prompt_generator.py` forcibly wraps all fields into a single text block. There's no way to designate a field like "goal" as the System prompt.
- **Suggested approach**: Add a toggle on each field in the `InputPanel` for "Role: System/User". The generator then produces a JSON array of message objects rather than a single string, and the Playground/Eval services pass this array natively to the OpenAI client.
- **Effort estimate**: Medium
- **Priority recommendation**: Nice-to-have

### Bulk Prompt Delete / Clear History
- **Problem it solves**: Users can only delete prompts one at a time. As history accumulates, clearing unwanted entries becomes tedious. Power users who experiment heavily may want to clear all history without deleting their saved templates.
- **Proposed solution**: Add multi-select mode to the History tab (checkboxes appear on hover). A "Delete selected" action fires one `DELETE` request per checked item. A "Clear all history" button (unnamed prompts only) provides a single-click cleanup option. The backend API already supports individual deletes; no new endpoints needed.
- **Effort**: Medium
- **Dependencies**: None (individual delete endpoints already exist)

### Multiple Output Formats
- **Problem it solves**: XML is the only output format. Some LLMs and workflows prefer Markdown headings or plain JSON. Users must manually reformat output after generation.
- **Proposed solution**: Add an `output_format` parameter to the generate request (`xml` | `markdown` | `json`). The `prompt_generator.py` service adds format-specific rendering logic. UI adds a format selector.
- **Effort**: Medium
- **Dependencies**: None

---

## Priority: Low / Future

_"Weekly Summary Email Delivery" and "Per-Variable Descriptions in the Editor" shipped 2026-07-12 (the latter's scope extended to also cover a real variable type, not just description) — see `product/FEATURES.md` and `product/DECISIONS.md`._

### Multi-Turn Playground Sessions
- **Value**: Developers can test prompts intended for conversational workflows across follow-up turns, rather than validating only the first model response in isolation.
- **Gap identified**: The Playground compiles one template into a single model request and persists one output per run; there is no conversation transcript or follow-up-message model (`backend/app/services/playground_service.py`, `backend/app/models/playground_run.py`, `frontend/src/components/PlaygroundView.tsx`).
- **Suggested approach**: Add an optional session mode with a persisted message transcript, follow-up user messages, resolved model and variables, and cumulative usage/cost. Sequence this after or alongside the existing system/user message-role proposal so message semantics are shared rather than implemented twice.
- **Effort estimate**: High
- **Priority recommendation**: Future

### Multi-Model Evaluation (A/B Testing)
- **Value**: Users need to know if a cheaper model (e.g., `gpt-4o-mini`) can perform as well as an expensive model (`gpt-4o`) for their specific prompt and eval set.
- **Gap identified**: `EvalService` currently runs against the single model configured on the user's provider connection. The Playground allows selection among that connection's suggested models, but bulk eval does not allow side-by-side comparison.
- **Suggested approach**: Allow selecting multiple models in the Evaluate tab. `EvalService` executes each case against all selected models and displays a comparative scorecard.
- **Effort estimate**: High
- **Priority recommendation**: Future

### Prompt Import (from file)
- **Problem it solves**: `GET /api/prompts/export` (shipped 2026-07-12) lets users back up their prompts as JSON, but there's no way to bring that file back in — to restore, migrate between environments, or onboard from a shared template pack.
- **Proposed solution**: A Settings → Data "Import" action accepting the export JSON shape; creates new prompts (and optionally their version history) under the importing user's account. Needs de-duplication/naming-conflict handling.
- **Effort**: Medium
- **Dependencies**: None (export already shipped)

### Shareable Prompt Links
- **Problem it solves**: There is no way to share a specific prompt with another person (e.g. via a URL). Collaboration is manual — users must copy/paste generated XML.
- **Proposed solution**: Generate a time-limited or permanent read-only public URL for a prompt (e.g. `/share/{token}`). Viewer sees the rendered XML without needing an account.
- **Effort**: Medium
- **Dependencies**: None

### Rate Limit Retry Countdown
- **Problem it solves**: Users hitting rate limits (register 5/min, generate 30/min) are blocked with generic error alerts. There is no countdown telling them when they can resume work.
- **Proposed solution**: Extract the `Retry-After` header sent by FastAPI slowapi on `429 Too Many Requests` responses. Render a visual countdown timer overlay in the UI and temporarily disable action buttons until the window clears.
- **Effort**: Low
- **Dependencies**: None

### Operator Diagnostics Administration UI
- **Problem it solves**: The operator SMTP check API route (`POST /api/admin/smtp/check`) requires using custom HTTP clients (like Postman or curl) with diagnostic headers. There is no web interface for administrators to trigger maintenance checks or view database metrics.
- **Proposed solution**: Create a dedicated, token-guarded admin diagnostics page (e.g. `/admin`) where operators can input their `ADMIN_DIAGNOSTICS_TOKEN`, trigger SMTP connectivity smoke checks, and view database size/integrity metrics in real-time.
- **Effort**: Medium
- **Dependencies**: None

---

## Icebox (no current priority)
- **Team workspaces** — Shared prompt libraries for organizations; requires multi-tenancy and significant auth refactor
- **Prompt quality rating** — User-annotated satisfaction scores on generated prompts for self-reference
- **Webhook / API key access** — Allow external tools to call the generate endpoint programmatically with a long-lived API key
- **Mobile-responsive layout** — Responsive hamburger navigation shipped 2026-07-19, but content pages (Library, Editor, Playground, Evaluate) remain desktop-first; full mobile-optimized layouts are unexplored
