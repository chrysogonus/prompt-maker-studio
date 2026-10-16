# Repository refactoring

Historical implementation record: completed and approved 2026-10-11.
The structures and verification counts below describe that refactoring snapshot,
not the current release. For current architecture, features and release work, see
the [documentation index](README.md), [feature inventory](../product/FEATURES.md)
and [roadmap](../product/ROADMAP.md).

Original goal: preserve functionality and simplify internals, including the
0.3.0 UI cleanup. Refactoring happens on `dev`; intentional feature changes use
separate `feat/...` branches from `dev` and merge back into `dev`.

## Constraints

- Preserve REST/MCP contracts, routes, browser storage keys, error behavior,
  transaction boundaries, metrics, credentials, and existing data.
- Keep FastAPI, SQLAlchemy, SQLite, the custom migration runner, Next.js,
  React, TypeScript, CSS Modules, and the existing visual identity.
- Keep deferred refinement/evaluation APIs and data; no automatic AI calls.
- Use automated extraction for large moves and existing tests as the behavior
  contract. Add characterization tests for uncovered cross-boundary behavior.
- No commits, pushes, publishing, deployment, or production database access.
- Never access `.env`. Run local CI with `COMPOSE_DISABLE_ENV_FILE=1`; E2E
  already uses `--env-file /dev/null` and synthetic credentials.

## Execution sequence

1. Establish baseline; align CI and documentation with `dev`.
2. Protect section rendering and REST/MCP parity with characterization tests.
3. Extract prompt operations into services shared by REST and MCP.
4. Separate account responsibilities and domain schemas.
5. Separate application HTTP setup and migration machinery/steps.
6. Extract frontend request transport and domain API methods, retaining retry
   and session semantics.
7. Separate editor state/persistence/mutations from presentation.
8. Separate library, settings, auth and shell responsibilities; share library
   loading/invalidation within the authenticated account.
9. Clarify retained AI/deferred service boundaries without changing execution.
10. Update tooling, paths and docs; run integrated verification and review.

Backend verification: `make lint-backend && make test`, plus the 90% coverage
gate at integration. Frontend verification: `make lint-frontend && make
test-frontend`, retaining existing coverage floors. Final verification:
`COMPOSE_DISABLE_ENV_FILE=1 make ci-local`.

## Progress and decisions

- Initial checkout: `dev`, HEAD `9c4ed9a`; preserve the existing root AGENTS.md
  change from the preceding task.
- Original prompt/API characterization suite: 103 passing tests. Initial lint/build
  checks passed. The initial integrated baseline overlapped new fixture files and
  failed at the Docker fixture import; it is not recorded as a clean baseline.
  The frontend Docker builder now includes the shared fixture directory.
- Execute inline on the user-requested `dev` checkout; an additional worktree
  or refactoring branch would conflict with the requested workflow.
- Behavioral refactors use passing characterization tests before and after;
  new boundaries also receive focused tests. Do not invent failing behavior
  merely to satisfy a test-first ceremony.

## Implemented structure

- Shared prompt ownership, library, folder, version and export services serve
  REST and MCP independently. Transport adapters translate operation failures.
- Domain schemas replace the mixed ORM/schema module. Auth routers separate
  sessions, profiles, connections and password recovery; account services own
  the database/email work. Evaluation case/CSV/history persistence is separate
  from HTTP and model execution.
- Application construction is explicit (`create_app`); HTTP configuration is
  separate and database initialization runs in the application lifespan.
- The existing 24 migration IDs, order, transactions and SQL are retained in
  step modules, with a registry and runner. Historical section-recovery helpers
  are frozen beside the migration.
- Frontend feature folders contain editor, library, settings and auth UI,
  controllers, persistence and co-located tests. Pages/layout delegate to these
  modules. Settings sections are independently readable components.
- `ApiClient` remains the public facade over domain methods and session transport.
  Renewal remains opt-in, retries once, and reads the rotated CSRF cookie.
- Authenticated library consumers share in-flight requests and invalidation
  through an account-keyed provider; optimistic undo state stays local.
- Shared rendering fixtures exercise identical frontend/backend expectations.
  Build contexts, paths, architecture docs and agent playbooks are aligned.

Ruling: Keep the existing LLM execution, pricing, budget, billing and provider
services rather than introducing a generic AI orchestration framework. Their
ordering and transaction responsibilities differ; persistence extraction removes
mixed responsibilities without risking billing or expanding behavior.

## Verification record

- Entire generated OpenAPI document matches original HEAD exactly after the
  backend extractions (including paths, schemas, errors and operation IDs).
- Evaluation HTTP regression suite: 32 passed after service extraction.
- Migration/backup/application/docs focused checks: 18 passed.
- Frontend coverage gate passes after boundary tests: 78.38% statements,
  73.07% branches, 79.70% functions, 79.72% lines; thresholds unchanged.
- Full backend suite: 702 passed; the integrated coverage run also passes at
  96.54%, above the unchanged 90% requirement.
- Final frontend lint/types and coverage suite: 197 passed; 78.53% statements,
  73.34% branches, 79.88% functions, 79.83% lines. One pre-existing ESLint
  navigation warning remains in `src/app/error.tsx` (present in baseline).
- Independent review compared extracted behavior and byte-identical moved
  stylesheets. Its library stale-read finding was reproduced and fixed: shared
  pending reads now honor invalidation before resolving, and folder mutations
  explicitly reload fresh data. Regression tests cover rename/removal, library
  mounting during an invalidated read, and failure of that older read.
- Browser checks after the review fix: 13 passed, including accessibility,
  registration/save/reload, versions, variables, two-tab conflicts and folders.
- First integration run passed code/security/build/coverage/browser/Compose/
  backup/context checks, then stopped at smoke startup because an extra browser
  verification stack occupied the same local port. That stack cleaned up.
  The complete sequential rerun passed: `COMPOSE_DISABLE_ENV_FILE=1 make
  ci-local` returned exit code 0, including all unit/coverage/browser checks,
  Compose validation, backup-worker/context guards, container smoke startup,
  Trivy image gates and licensing inventory checks.

Ruling: Preserve original tracked-file newline styles and restore generated
`next-env.d.ts`; these are verification artifacts rather than requested source
changes. Diff whitespace verification uses Git's `cr-at-eol` setting for the
existing CRLF files.

Final state: all ten phases complete on the user-requested `dev` checkout.
The user requested committing the verified changes after implementation. No
feature was added, so no feature branch or merge was needed. No push,
publication or deployment was performed.
At completion, production-data migration rehearsal remained release work; this
session used only synthetic/legacy fixtures and isolated test databases. Later
releases are recorded separately; production upgrades still require rehearsal
and explicit deployment approval.
