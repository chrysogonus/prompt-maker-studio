# Product Backlog

> Reviewed against the codebase: 2026-10-16 (published 0.5.1).
> Items below describe unimplemented scope. See [implemented features](FEATURES.md)
> and the [roadmap](ROADMAP.md) for delivered work and release status.
> Existing priorities are retained; this sync does not select new product work.

## Priority: High

### Extend AI Refinement Controls

- **Value**: Direct a specific change and keep only the suggested edits needed.
- **Current gap**: Questions, section diffs, local Apply/Undo and Save are implemented. Direct change instructions and individual section acceptance are absent.
- **Suggested approach**: Extend `frontend/src/features/editor/RefinePanel.tsx` and `backend/app/services/prompt_refiner.py`, keeping section structure and explicit review before Save.
- **Effort**: High.

### Calibrate Evaluation Scores

- **Value**: Give scores an understood relationship to a user's goal.
- **Current gap**: Explicit runs, reviewed suggestions, case CSV tools, historical outputs, run comparison and manual ratings are implemented; automated scores have not been calibrated against human judgments.
- **Suggested approach**: Compare automatic and AI-review scores with human ratings on representative cases before treating them as quality gates. Keep automatic execution disabled.
- **Source**: `frontend/src/features/evaluation/`, `backend/app/services/eval_service.py`.
- **Effort**: High.

## Priority: Medium

### First-Run Onboarding With a Seeded Sample Prompt

- **Value**: Make the first reusable template easier to understand.
- **Current gap**: The empty library offers New prompt, Paste a prompt and starter templates; registration creates no sample prompt. `backend/scripts/seed_demo_user.py` is opt-in QA data, not new-account onboarding.
- **Suggested approach**: Offer a deletable sample with variables and optional evaluation cases; tags and the retired Playground are outside the current workflow.
- **Effort**: Low.

### Version Milestones

- **Value**: Identify important snapshots such as "known good".
- **Current gap**: Optional save notes, current-version notes, historical notes and variable metadata snapshots already exist. Named or pinned milestones do not.
- **Suggested approach**: Add milestone labels to existing version history and show them consistently in comparisons and restore confirmation.
- **Source**: `backend/app/services/prompt_version_service.py`, `frontend/src/features/editor/HistoryPanel.tsx`.
- **Effort**: Low.

### Prompt Trash & Restore

- **Value**: Recover a deleted prompt with its versions and evaluation history.
- **Current gap**: The library provides a five-second local Undo before sending DELETE. Once committed, server deletion is permanent and cascades through dependent records; there is no persistent trash.
- **Suggested approach**: A 30-day soft-delete view with restore and explicit permanent deletion, excluded from normal library and execution queries.
- **Source**: `frontend/src/features/library/useLibrary.ts`, `backend/app/services/prompts/library.py`.
- **Effort**: Medium.

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

### Bulk Prompt Delete / Recovered History Cleanup

- **Value**: Tidy large collections and recovered near-duplicates.
- **Current gap**: Individual deletion and folder rename/removal exist; multi-select prompt deletion and duplicate detection do not. The old unnamed History tab no longer exists; migration 024 retained entries as named prompts in Recovered history.
- **Suggested approach**: Add deliberate multi-selection to the library, preserving deletion feedback and Undo. Individual DELETE is available; confirm transaction/error behavior before choosing batch requests.
- **Effort**: Medium.

### Multiple Output Formats

- **Value**: Copy Markdown headings or JSON for workflows that prefer them.
- **Current gap**: `backend/app/services/prompt_sections.py` and `frontend/src/lib/sections.ts` render XML-style tags only. There is no generate endpoint or format selector.
- **Suggested approach**: Start with a Markdown copy option and keep frontend/server rendering contracts aligned.
- **Effort**: Medium.

## Evaluation Follow-ups

Refinement and evaluation are implemented. These are extensions to their current
workflows, rather than rebuild prerequisites.

### Evaluation-Informed Refinement

- **Value**: Target observed failures when refining a prompt.
- **Current gap**: The refiner receives sections and Q&A answers, without evaluation-result context.
- **Suggested approach**: Explicitly opt into a bounded selection of failing outputs, criteria and judge feedback from the latest run.
- **Source**: `backend/app/services/prompt_refiner.py`, `frontend/src/features/editor/RefinePanel.tsx`.
- **Effort**: Medium.

### Evaluation Health on Library Cards

- **Value**: See whether a template is tested and whether its last run used the current version.
- **Current gap**: The library shows no evaluation coverage or score badge; run version context exists. The product dashboard and its run-count service were retired.
- **Suggested approach**: A grouped evaluation summary for library cards, with explicit untested/stale states.
- **Effort**: Low.

### Eval Run Results Export (CSV)

- **Value**: Analyze outputs and scores outside the app.
- **Current gap**: CSV endpoints transfer test cases, not historical run results.
- **Suggested approach**: Add an owned-run export with snapshots, outputs, scores and rationales.
- **Source**: `backend/app/api/eval_routes.py`, `backend/app/models/eval_run_result.py`.
- **Effort**: Low.

### Evaluation Progress, Cancellation & Partial Results

- **Value**: See progress and stop remaining work during a larger evaluation.
- **Current gap**: Cases run on a five-worker thread pool, but the API is one synchronous request without progress/cancellation. Completed worker outcomes and reported usage are collected before persistence; provider I/O timeouts bound calls, without a separate future deadline.
- **Suggested approach**: A persistent job with per-case status, cancellation of remaining work, retained results/usage and UI recovery after navigation.
- **Source**: `backend/app/services/eval_service.py`, `frontend/src/features/evaluation/useEvaluation.ts`.
- **Effort**: High.

### Custom Eval Judges

- **Value**: Choose a grading rubric or model suitable for a task.
- **Current gap**: Judge feedback is structured, but the system rubric is fixed and grading reuses the execution connection/model.
- **Suggested approach**: Explicit advanced judge settings with clear provider and charge context.
- **Effort**: Medium.

### Evaluation Baselines & Regression Gates

- **Value**: Compare a change with an explicitly chosen known-good run.
- **Current gap**: Historical run comparison exists; selected baselines, acceptable-drop thresholds and acceptance gates do not. Evaluation completion/regression emails were retired.
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

- **Prompt branching**: Duplication has no lineage; add parent/branch context if non-linear versioning becomes valuable. High effort.
- **Full-fidelity backup restore through the UI**: Library JSON/Markdown import now creates new copies with title/folder preview and retries. It does not restore history, dates, notes or favorites. A complete restore would need explicit conflict and duplicate handling. Medium effort.
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
