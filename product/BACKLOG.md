# Product Backlog

> Reviewed against the codebase: 2026-10-28 (published 0.12.0; later changes on `dev`).
> Items below describe unimplemented scope. See [implemented features](FEATURES.md)
> and the [roadmap](ROADMAP.md) for delivered work and release status.
> Existing priorities are retained; this sync does not select new product work.

## Priority: High

### Extend AI Refinement Controls

Phase 5 of the evaluate → refine loop (see [below](#evaluate--refine-loop-plan-of-2026-10-20)).

- **Value**: Direct a specific change and keep only the suggested edits needed.
- **Current gap**: Questions, test-result evidence, draft checks against test cases, section diffs, local Apply/Undo and Save are implemented. Direct change instructions and individual section acceptance are absent.
- **Suggested approach**: Add an optional `instruction` (up to 1,000 characters) to `RefineSnapshotDraftRequest`, usable with or without Q&A and treated as the user's own request; keep the same-sections validation and say in the panel that instructions cannot add or remove sections. In review, a checkbox per changed section and Apply selected; the backend already validates each section independently, so partial apply needs no backend change.
- **Source**: `frontend/src/features/editor/RefinePanel.tsx`, `backend/app/services/prompt_refiner.py`, `backend/app/schemas/refinement.py`.
- **Effort**: Medium (about three days).

### Calibrate Evaluation Scores

- **Value**: Give scores an understood relationship to a user's goal.
- **Current gap**: Users can rate AI-reviewed outputs themselves, and Run history reports how often the AI review agreed with them (within one star). Agreement is counted only over loaded history; refinement's draft check states it, but run comparison does not, and it does not yet change how AI-review scores are presented. Automatic checks are deterministic and not compared.
- **Suggested approach**: Show the agreement next to AI-review scores in run comparison too, and warn when agreement is low. Keep automatic execution disabled.
- **Source**: `frontend/src/features/evaluation/`, `backend/app/services/eval_service.py`.
- **Effort**: High.

## Priority: Medium

### First-Run Onboarding With a Seeded Sample Prompt

- **Value**: Make the first reusable template easier to understand.
- **Current gap**: The empty library leads with Add existing prompts, then New prompt and starter templates; registration creates no sample prompt. `backend/scripts/seed_demo_user.py` is opt-in QA data, not new-account onboarding.
- **Suggested approach**: Offer a deletable sample with variables and optional evaluation cases; tags and the retired Playground are outside the current workflow.
- **Effort**: Low.

### Version Milestones

- **Value**: Identify several important snapshots, not only one.
- **Current gap**: One version per prompt can be marked known good. Several named milestones, and showing the known-good result beside a refinement check, do not exist.
- **Suggested approach**: Extend the single `known_good_version` to labelled milestones only if people ask for more than one.
- **Source**: `backend/app/services/prompt_version_service.py`, `frontend/src/features/editor/HistoryPanel.tsx`.
- **Effort**: Low.

### Prompt Trash & Restore

- **Value**: Recover a deleted prompt with its versions and evaluation history.
- **Current gap**: The library provides a ten-second local Undo before sending DELETE. Once committed, server deletion is permanent and cascades through dependent records; there is no persistent trash.
- **Suggested approach**: A 30-day soft-delete view with restore and explicit permanent deletion, excluded from normal library and execution queries.
- **Source**: `frontend/src/features/library/useLibrary.ts`, `backend/app/services/prompts/library.py`.
- **Effort**: Medium.

### Import Source Key & Remembered Choices

- **Value**: Re-importing an Obsidian vault or Notion export behaves like a sync: a renamed note updates its prompt, and notes left out or placeholders kept as text stay that way.
- **Current gap**: Re-import matches by title only. Inputs the library prompt already has are converted again, and Update is offered only when one prompt has the title, but nothing about the source is stored, so unticked notes are ticked again on every import and renamed notes import as new.
- **Suggested approach**: Store a source key per imported prompt (vault-relative path or Notion page ID; migration), match on it before the title, and keep per-source choices (left out, placeholders kept).
- **Source**: `frontend/src/features/library/ImportPrompts.tsx`, `frontend/src/lib/promptImport.ts`, `backend/app/models/prompt.py`.
- **Effort**: Medium.

### Small Follow-ups from the 2026-10-23 UI/UX Test

- **Open imported prompts as a batch**: after an import into several folders, Open imported prompts shows All prompts, where the new prompts lead the default recency sort. A view of exactly the imported prompts needs a new library view (the IDs or an import marker).
- **Inputs highlighted while editing**: `{{inputs}}` are highlighted in the preview only; the section text areas would need a mirrored highlight layer.
- **Import review on phones**: a filter and "collapse all" for reviewing hundreds of notes in the small dialog.
- **Sequential prompt IDs**: IDs reveal the total number of prompts to any user; not a vulnerability given the ownership checks, but worth deciding before a public launch.
- **Source**: `prompt-maker-ux-test-2026-10-23.md` (not checked in).

### Variable Defaults & Typed Validation

- **Value**: Reuse predictable inputs without confusing examples with defaults.
- **Current gap**: Hints, required flags and explicitly loaded example inputs are implemented. Missing required values block normal filled copying and Try once in the UI; Copy with placeholders remains explicit. Automatic defaults and typed backend execution validation are absent; legacy types remain stored.
- **Suggested approach**: Define defaults and optional type constraints separately from examples, then apply a consistent contract to relevant execution boundaries.
- **Source**: `backend/app/schemas/prompts.py`, `backend/app/services/prompt_compiler.py`, `frontend/src/features/editor/VariablesPanel.tsx`, `frontend/src/features/editor/PreviewPane.tsx`.
- **Effort**: Medium.

### Scalable Library Search, Sort & Folder Filtering

- **Value**: Find prompts without downloading the complete library.
- **Current gap**: The saved-prompts API returns all named prompts with optional folder/favorite filters. The browser already has folder/favorite views, name/folder/section-text search and content-recency/title sorting; it lacks server-side search and pagination. Tags were retired.
- **Suggested approach**: Add server-side search, validated sort and pagination with a count, then connect the existing library controls.
- **Source**: `backend/app/services/prompts/library.py`, `frontend/src/features/library/useLibrary.ts`.
- **Effort**: Medium.

### Duplicate Detection / Recovered History Cleanup

- **Value**: Tidy large collections and recovered near-duplicates.
- **Current gap**: Selecting several prompts to move or delete them together (with one Undo) and folder rename/removal exist; duplicate detection does not. The old unnamed History tab no longer exists; migration 024 retained entries as named prompts in Recovered history.
- **Suggested approach**: Flag prompts whose sections match (after whitespace normalisation) and offer them for review in the existing multi-selection, keeping deletion feedback and Undo.
- **Effort**: Medium.

### Multiple Output Formats

- **Value**: Copy Markdown headings or JSON for workflows that prefer them.
- **Current gap**: `backend/app/services/prompt_sections.py` and `frontend/src/lib/sections.ts` render XML-style tags only. There is no generate endpoint or format selector.
- **Suggested approach**: Start with a Markdown copy option and keep frontend/server rendering contracts aligned.
- **Effort**: Medium.

## Evaluation Follow-ups

Refinement and evaluation are implemented. These are extensions to their current
workflows, rather than rebuild prerequisites.

### Evaluate → Refine Loop (plan of 2026-10-20)

After a review of comparable products (Langfuse, Agenta, Promptfoo, prompt-library
extensions, MCP prompt managers), the product deepens its own evaluation, refinement and
versioning by joining them into one loop instead of adding new surfaces. Decisions are in
[DECISIONS.md](DECISIONS.md); delivered parts are in [FEATURES.md](FEATURES.md).

| Phase | Scope | Status |
|---|---|---|
| 1 | Rate AI-reviewed outputs; show how often AI review agrees (migration 030) | Released in 0.9.0 |
| 2 | Runs record the text they tested; evaluate unsaved sections (migration 031) | Released in 0.9.0 |
| 3 | Refine from chosen test results; check a draft against test cases before applying | Released in 0.9.0 |
| 4 | One known-good version; test results in History; library test status (migration 032) | Released in 0.9.0 |
| 5 | Direct refine instructions and per-section accept | Backlog: [Extend AI Refinement Controls](#extend-ai-refinement-controls) |
| 6 | Persistent evaluation jobs, then a user-started "find a better version" | Backlog: [Evaluation Progress](#evaluation-progress-cancellation--partial-results), [Find a Better Version](#find-a-better-version-user-started) |

Also delivered alongside: Claude as a custom connector on the existing MCP server, the
permitted way to use a Claude subscription with the app (in-app AI still needs an API key
or local model).

Left over from phases 1–4, tracked in the items below: AI-review agreement beside compared
scores ([Calibrate Evaluation Scores](#calibrate-evaluation-scores)), the known-good run as
the default comparison and in refinement checks ([Evaluation Baselines](#evaluation-baselines--regression-gates)),
several milestones ([Version Milestones](#version-milestones)), and server-side summaries
for long histories (Low / Future).

### Eval Run Results Export (CSV)

- **Value**: Analyze outputs and scores outside the app.
- **Current gap**: CSV endpoints transfer test cases, not historical run results.
- **Suggested approach**: Add an owned-run export with snapshots, outputs, scores and rationales.
- **Source**: `backend/app/api/eval_routes.py`, `backend/app/models/eval_run_result.py`.
- **Effort**: Low.

### Evaluation Progress, Cancellation & Partial Results

Phase 6 of the evaluate → refine loop. Build it when large suites hit the timeout, the
20-case cap is raised, or Find a Better Version is wanted.

- **Value**: See progress and stop remaining work during a larger evaluation.
- **Current gap**: Cases run on a five-worker thread pool, but the API is one synchronous request without progress/cancellation. Completed worker outcomes and reported usage are collected before persistence; provider I/O timeouts bound calls, without a separate future deadline. A hosted AI-review case makes two sequential calls of up to 30 seconds, so 20 cases on 5 workers can exceed the browser's two-minute limit for billed requests, and Refine's draft check may run two suites at once.
- **Suggested approach**: An `eval_jobs` table with per-case status and an in-process worker (single-instance SQLite needs no queue service): cancellation of remaining work, retained results/usage, UI recovery after navigation, and unfinished jobs marked interrupted on restart.
- **Source**: `backend/app/services/eval_service.py`, `frontend/src/features/evaluation/useEvaluation.ts`, `frontend/src/features/editor/RefineTests.tsx`.
- **Effort**: High.

### Find a Better Version (user-started)

- **Value**: Let the app search for an improvement and show only drafts that beat the current or known-good version on the user's own cases.
- **Current gap**: Refinement produces one draft per request and its check runs on demand. Nothing generates and compares several candidates.
- **Suggested approach**: On top of persistent jobs, a user-started job generates two or three candidates (optionally from chosen failing results), tests each with the existing unsaved-sections run, and presents only those that score higher, with the per-case comparison and agreement caveat. Show the estimated cost (candidates × cases × up to two calls) and require confirmation; it never runs on its own or on save.
- **Source**: `backend/app/services/prompt_refiner.py`, `backend/app/services/eval_service.py`, `frontend/src/features/editor/RefineTests.tsx`.
- **Effort**: High; depends on Evaluation Progress, Cancellation & Partial Results.

### Custom Eval Judges

- **Value**: Choose a grading rubric or model suitable for a task.
- **Current gap**: Judge feedback is structured, but the system rubric is fixed and grading reuses the execution connection/model.
- **Suggested approach**: Explicit advanced judge settings with clear provider and charge context.
- **Effort**: Medium.

### Evaluation Baselines & Regression Gates

- **Value**: Compare a change with an explicitly chosen known-good run.
- **Current gap**: Historical run comparison exists and runs of the known-good version are labelled. Choosing it as the default comparison in Evaluate, showing its score in Refine's draft check, acceptable-drop thresholds and acceptance gates do not. Evaluation completion/regression emails were retired.
- **Suggested approach**: Baseline selection, per-case/aggregate deltas and an overridable warning before accepting a regression.
- **Effort**: Medium.

### Rich Deterministic Eval Assertions — JSON-Path & Typed Checks

- **Value**: Check structured values without an AI judge.
- **Current gap**: Contains, `!` not-contains, `~` regex and `{json}` checks already exist with bracket-aware criteria splitting. JSON-path value assertions and numeric-range checks do not.
- **Suggested approach**: Extend the rule contract while preserving existing criteria and CSV behavior.
- **Source**: `backend/app/services/eval_service.py`, `backend/app/services/safe_regex.py`.
- **Effort**: Medium.

### Multi-Model Evaluation (A/B Testing)

- **Value**: Compare a template across models.
- **Current gap**: An evaluation uses the active connection's single configured model; there is no per-run model picker or multi-model scorecard. The standalone Playground was retired.
- **Suggested approach**: Explicit model selection and comparable per-model results, after defining provider/charge semantics.
- **Effort**: High; future priority.

## Priority: Low / Future

- **Server-side evaluation summaries**: AI-review agreement is counted in the browser over loaded Run history pages, History matches the newest 100 runs, and the library status reads one row per run. Move these to SQL aggregation if histories grow long. Low effort.

- **Prompt branching**: Duplication has no lineage; add parent/branch context if non-linear versioning becomes valuable. High effort.
- **Full-fidelity backup restore through the UI**: Library JSON/Markdown import now creates new copies with title/folder preview and retries. It copies favourites but does not restore history, dates or notes. A complete restore would need explicit conflict and duplicate handling. Medium effort.
- **Shareable prompt links**: No public per-prompt sharing endpoint exists; copied text is the current sharing path. Medium effort.
- **Rate-limit retry countdown**: Rate-limited routes return 429; the UI has no dedicated retry timer. Use the actual response headers and current route limits, rather than the removed generate endpoint. Low effort.
- **Operator diagnostics administration UI**: `POST /api/admin/smtp/check` exists, but no admin page. Keep diagnostics credentials separate from normal account authorization. Medium effort.

## Parked with the Retired Playground

The standalone Playground and its endpoints were retired in 0.3.0. Try once now
runs a bounded draft without saving prompt/run history, and evaluations reuse the
internal `PlaygroundService`; neither is a restored conversational workbench.

- **Generation controls and presets**: No temperature/output-token preset API or persisted generation configuration exists. Reassess against Try once/evaluation needs before restoring Playground-specific UI. Medium effort.
- **Multi-turn sessions**: No stored conversational transcript or follow-up execution exists. High effort.
- **System/user message roles**: Sections render into one text block; authors cannot assign sections to message roles. A role-aware contract would need coordinated rendering and execution changes. Medium effort.

## Icebox (no current priority)

- **Team workspaces**: Private per-account libraries exist; shared workspace ownership does not.
- **Prompt quality ratings**: Per-prompt satisfaction annotations are absent; manual ratings currently apply to evaluation results.
- **Webhooks / long-lived API keys**: MCP OAuth linking exists; generic webhook subscriptions and user-managed API keys do not.
- **Further mobile usability work**: Phone navigation, editor tabs, full-screen refinement/history, responsive library cards and mobile evaluation layouts already exist. No specific additional mobile feature is committed here.
