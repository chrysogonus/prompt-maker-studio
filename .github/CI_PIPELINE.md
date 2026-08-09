# Continuous Integration Pipeline

The executable source of truth is [`.github/workflows/ci.yml`](workflows/ci.yml).
This guide explains the workflow's intent, required gate, artifacts, and local
equivalents without duplicating every YAML step.

## Triggers and Concurrency

The workflow runs for:

- every pull request, regardless of target branch;
- pushes to `main` and `development`;
- pushes of a `v*` version tag, which is what triggers publishing;
- manual `workflow_dispatch` runs.

Only the newest run for a pull request or branch remains active. The workflow
uses read-only repository permissions by default; only the image-publish job
receives `packages: write`, and it runs only for version tags.

Every action is pinned to a full commit SHA with the version in a trailing
comment. A mutable major tag can be retargeted upstream, and this workflow has a
job that can replace the project's public images — Dependabot's
`github-actions` ecosystem updates the pins and keeps the comment current.

## Jobs

| Job ID | Check name | What it establishes |
|---|---|---|
| `secret-scan` | `Repository - Secret Scan` | Pinned Gitleaks scan of every reachable commit plus tracked/non-ignored working-tree files |
| `backend-quality` | `Backend - Lint, Security & Tests` | Lock consistency, Ruff, Bandit, pip-audit, pytest, and the 90% coverage gate |
| `frontend-quality` | `Frontend - Lint, Security & Build` | TypeScript, ESLint, dependency audits, production build, and Vitest with the coverage floors in `frontend/vitest.config.ts` |
| `docker-build` | `Docker - Build Validation` | Build-context secret exclusions, matrix builds, license-material checks, LGPL-bundle exclusion, no-baked-API-origin and no-package-manager checks, a Trivy vulnerability scan, and a live backend smoke check |
| `browser-e2e` | `Browser - End-to-End Tests` | Playwright Chromium journeys against an isolated Compose stack |
| `compose-validate` | `Docker Compose - Config Validation` | Base, local, E2E, and GHCR production Compose combinations plus non-root backup ownership/integrity |
| `codeql` | `Static Analysis - CodeQL` | CodeQL `security-extended` queries over the TypeScript/React sources — the counterpart to Bandit, which covers only the backend. Runs on public repositories only (see below) |
| `all-checks-passed` | `All Quality Gates Passed` | Stable aggregate result for all required quality jobs |
| `publish` | `Publish - <service> → GHCR` | On a `v*` tag, publishes backend/frontend images tagged by semver and `sha-<short>`, with build provenance and an SBOM attached. No `latest` tag: it made an unready or poisoned artifact the default pull |

The image scan gates on HIGH/CRITICAL findings that have a fix available
(`--ignore-unfixed`), scoped to the two images this project builds; run the same
scan locally with `make security-images`. The optional Prometheus and Grafana
images are third-party, carry upstream advisories nothing here can fix, and sit
behind the `monitoring` Compose profile rather than in the default stack.

The frontend audit prints full-tree findings for visibility but gates the
production dependency tree with `npm audit --omit=dev --audit-level=moderate`.
The runtime image does not ship development or optional dependencies. In
particular, CI verifies that Next's optional `sharp-libvips` native bundle is
absent; the licensing rationale is recorded in
[`docs/licensing.md`](../docs/licensing.md).

## Branch Protection

Require the stable `All Quality Gates Passed` check rather than every
implementation job. The aggregate already depends on all seven quality jobs,
and using one required name prevents matrix expansion or job refactoring from
silently changing branch rules.

`codeql` is deliberately a job in this workflow rather than the separate
`codeql.yml` GitHub offers by default, so it feeds that aggregate too. It holds
`security-events: write` scoped to itself; the workflow default stays
`contents: read`.

It is also gated on `github.event.repository.private == false`. CodeQL is free
on public repositories but needs GitHub Advanced Security on private ones, where
the upload fails outright — so on a private repository the job is skipped and
the aggregate accepts that, reporting it in the run summary. Nothing needs to be
switched on when the repository is published; the job starts running by itself.
Two consequences worth knowing:

- Do **not** also enable GitHub's *default setup* for code scanning. This
  workflow is an advanced-setup configuration, and running both produces
  duplicate or conflicting analyses.
- `publish` lists `codeql` among its `needs`, so a skipped CodeQL also skips
  publishing. Tagging a release while the repository is private therefore
  produces no images. That is deliberate: images are not published from a
  codebase whose static analysis never ran.

See [`.github/BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md) for the recommended
repository ruleset. That document describes a desired configuration; repository
administrators must confirm what is actually active in GitHub.

## Local Equivalents

Run commands from the repository root:

| Command | Coverage |
|---|---|
| `make check-secrets` | Every reachable commit and tracked/non-ignored working-tree file, without opening ignored `.env` files |
| `make check-locks` | Installed backend consistency and committed lock freshness |
| `make lint-backend` | Ruff check and format validation |
| `make lint-frontend` | TypeScript and ESLint |
| `make test-cov` | Backend tests with the 90% coverage gate |
| `make test-frontend` | Vitest with the coverage floors (same command CI runs) |
| `make security-backend` | Bandit and pip-audit |
| `make security-frontend` | Informational full audit plus gating production audit |
| `make docker-smoke-test` | Both image builds and backend container smoke test |
| `make check-docker-context` | Actual Docker build-context exclusion for root and nested environment files |
| `make compose-check` | All supported Compose combinations |
| `make check-backup-worker` | Non-root backup execution, host ownership, and compressed SQLite integrity |
| `make test-e2e` | Isolated Playwright/Compose browser suite |
| `make ci-local` | Full local CI mirror |

`make ci-local` expects the development toolchains, Playwright Chromium, and a
working Docker daemon. See [`docs/development.md`](../docs/development.md).

`codeql` has no Make equivalent — it needs GitHub's hosted analysis and uploads
results to the repository's security tab. Review its findings there rather than
expecting a local reproduction.

## Reports and Artifacts

- Backend Bandit JSON and HTML coverage artifacts are uploaded for every run
  and retained for seven days.
- Coverage XML is submitted to Codecov when configured; upload failure does not
  fail CI.
- Playwright traces/screenshots are uploaded only when the browser job fails
  and are retained for seven days.

When a job fails, reproduce it with the matching Make target before diagnosing
lower-level commands. If a required check is missing rather than failing,
confirm the workflow trigger and required-check name against the current YAML.
