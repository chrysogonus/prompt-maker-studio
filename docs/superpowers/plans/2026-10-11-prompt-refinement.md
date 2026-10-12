# Prompt refinement implementation plan

**Goal:** Restore refinement inside the editor with explicit AI requests, reviewable section edits, local Apply/Undo and normal Save.

**Spec:** The user approved the in-chat proposal on 2026-10-11. Desktop refinement replaces the preview; mobile uses a full-screen dialog. Questions and answers survive closing while the source remains unchanged. Editing the source invalidates a session. No automatic AI calls or saves. Existing refinement endpoints remain compatible.

**Architecture:** Add authenticated snapshot endpoints alongside the saved-prompt API. Reuse the existing JSON-completion helper with structured section output, validating section names/order and per-section variables/tags. A focused refinement component owns its session; the editor owns applying and undoing local edits. Use existing CSS tokens, buttons, session transport and word diff.

**Constraints:** No dependencies, commits, pushes, deployments or `.env` access. Work on `feat/prompt-refinement` from `dev`. Preserve metadata, filled values and ordinary save/concurrency behavior.

## Tasks

- [x] Backend: write failing tests for unsaved snapshots, auth, input validation, budget enforcement, unchanged section structure and placeholder/tag preservation. Add `POST /api/prompts/refine/questions` and `/refine/draft`; draft returns validated `fields`. Record billed usage even when structural validation rejects a completed draft. Verify old and new routes/service tests.
- [x] Frontend: write failing editor tests for explicit start, current unsaved fields, answers/retry, review, Apply/Undo, normal Save, source invalidation and missing connection. Add facade methods and refinement pane, retaining session state while closed. Verify tests and type/lint checks.
- [x] Browser: exercise desktop/mobile and both themes, keyboard focus and axe; mock only AI responses. Add E2E regression coverage.
- [x] Documentation: update feature/decision records and backend test descriptions. Run `make ci-local` and inspect the full diff.

## Review focus

- Closing during a request must never apply a late response or repeat a billed call.
- Changed editor contents must never accept a draft made against older contents.
- Applying and undoing must preserve variable hints, types and filled values.
- Malformed drafts must never flatten sections or lose variables; users retain answers on failure.
- Empty questions, unchanged drafts, long sections and narrow screens need readable, actionable states.

## Progress

Plan recorded before implementation. User authorization covers implementation of the approved proposal; execute inline without further approval or commits.

Implementation and documentation are complete. Independent review findings were resolved with regression tests: multiline variables, nested XML examples, and bounded long-section comparisons. Final verification passed: `COMPOSE_DISABLE_ENV_FILE=1 make ci-local` (730 backend tests; 96.61% backend coverage), plus frontend lint/build/coverage after the long-diff fix (214 tests) and the final browser suite after the phone scrollbar adjustment (15 tests). Desktop and phone screenshots were inspected in both themes; axe and keyboard checks passed. Browser tests mock AI results while using real auth, persistence and version history. No live provider calls, commits, pushes or deployment were made.
