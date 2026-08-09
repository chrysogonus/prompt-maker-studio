# Contributing to Prompt Maker Studio

Thanks for your interest in Prompt Maker Studio. This is an early-stage project
maintained by a single author, so please read the
[project status](./README.md#project-status) before investing significant
time — interfaces still change without deprecation cycles.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
Contributions are accepted under the [Apache License 2.0](./LICENSE).

## Before you start

**Open an issue first** for anything larger than a typo or an obvious bug
fix. A short discussion saves you from building something that conflicts
with the [roadmap](./product/ROADMAP.md) or a
[settled decision](./product/DECISIONS.md).

Two documents are worth checking before proposing a feature:

- [`product/FEATURES.md`](./product/FEATURES.md) — what already exists
- [`product/DECISIONS.md`](./product/DECISIONS.md) — why past calls were made

## Development setup

Prerequisites: **Docker & Docker Compose**, **Python 3.12**, **Node.js 22**
(pinned in `frontend/.nvmrc`). AI-assisted features require a user-configured
hosted or self-hosted provider; the rest of the app runs without one.

```bash
git clone https://github.com/chrysogonus/prompt-maker-studio.git
cd prompt-maker-studio

# Creates .env from the template with a freshly generated SECRET_KEY
make setup
```

The default local stack needs no further environment edits. Set
`FRONTEND_URL=http://localhost:3000` if you are testing reset-email links; the
[Quick Start in `README.md`](./README.md#quick-start-with-docker) explains why
CORS is not involved. There is no LLM key in `.env` — if you are touching an
AI-backed feature, register an account and connect a provider under Settings →
API access (a local Ollama server needs no key and costs nothing).

```bash
# Option A — full containerized stack
make up

# Option B — local toolchains without Docker (use two terminals after install)
make install

# Terminal 1: FastAPI on :8000 with a process-scoped signing key
SECRET_KEY="$(.venv/bin/python -c 'import secrets; print(secrets.token_hex(32))')" make dev-backend

# Terminal 2: Next.js on :3000, proxying /api to the local backend
API_PROXY_TARGET=http://localhost:8000 make dev-frontend
```

`make help` lists all supported targets. See [`docs/development.md`](./docs/development.md)
for the longer walkthrough.

### About SECRET_KEY

`make setup` generates one with `openssl rand -hex 32`. If you write `.env` by
hand, generate your own — the backend refuses to start on any placeholder this
repository has ever published, or on a key shorter than 32 characters, because
a public signing key makes every session token forgeable.

### Dependency lockfiles

Both stacks are locked. Regenerate after changing a dependency:

```bash
make lock          # backend/requirements.lock, from backend/pyproject.toml
cd frontend && npm install   # frontend/package-lock.json
```

Commit the regenerated lockfile with the change that caused it.

## The Makefile is the interface

Use `make` targets rather than invoking tools directly; they mirror what CI
runs.

| Command | What it covers |
|---|---|
| `make lint-backend` | Ruff lint + format check |
| `make lint-frontend` | `tsc` type check + ESLint |
| `make test` | Backend pytest suite |
| `make test-cov` | Backend tests with coverage report |
| `make test-frontend` | Frontend Vitest suite, with the coverage floors CI enforces |
| `make setup-e2e` | Install locked frontend dependencies and Playwright Chromium (once) |
| `make test-e2e` | Playwright E2E against an isolated Compose stack |
| `make check-secrets` | Full reachable-history and tracked/non-ignored working-tree secret scan |
| `make ci-local` | Full local CI mirror — secret scan, lint, security, build, test |

**Definition of done:**

- Backend change → `make lint-backend && make test`
- Frontend change → `make lint-frontend && make test-frontend`
- Anything touching both, or before opening a PR → `make ci-local`

## Coding standards

- Handle errors explicitly. Never swallow exceptions silently.
- Validate inputs at system boundaries — request bodies and external API responses.
- Comment *why*, not *what*.
- Preserve public APIs. Keep diffs minimal and coherent; do not
  opportunistically restructure code you happened to touch.
- Match the surrounding code's naming, comment density, and idiom.

Stack-specific conventions live in [`backend/AGENTS.md`](./backend/AGENTS.md)
and [`frontend/AGENTS.md`](./frontend/AGENTS.md).

### Backend

Layering is `api/` → `services/` → `models/` → `database/`. Route handlers
stay thin and delegate to services. Ruff config is in `backend/pyproject.toml`
(line length 100, double quotes) — run `make lint-fix` rather than
hand-formatting.

**Coverage gate: CI enforces 90% (`--cov-fail-under=90`). New backend code
needs tests** under `backend/tests/`. When you add or remove a test module,
update the table in `backend/tests/README.md` in the same change.

### Database changes

There is **no Alembic**. Schema changes go through the idempotent migration
runner at `backend/app/database/migrations.py` — never raw SQL against a
running database. The numbered `.sql` files in `backend/migrations/` are
historical references and are not executed. See
[`backend/migrations/README.md`](./backend/migrations/README.md).

## Branches and commits

Branch from `main` using a type prefix:

```
feat/short-description     fix/short-description
ref/short-description      docs/short-description
chore/short-description
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(playground): add per-run cost breakdown
fix(auth): reject expired reset tokens
docs(readme): document ADMIN_DIAGNOSTICS_TOKEN
chore(backend)(deps): bump openai to 2.46.0
```

Common types: `feat`, `fix`, `docs`, `ref`, `chore`, `test`. Scope is
optional but encouraged. Use `!` or a `BREAKING CHANGE:` footer for
breaking changes.

## Pull requests

1. Rebase on the latest `main`.
2. Run `make ci-local` and make sure it is green.
3. Fill in the [PR template](./.github/PULL_REQUEST_TEMPLATE.md) — it is not decorative.
4. Link the issue with `Closes #123`.
5. Keep PRs focused. Unrelated refactors belong in their own PR.

All CI jobs must pass: backend lint/security/tests, frontend
lint/security/build/tests, CodeQL static analysis, Docker build validation,
Playwright E2E, and Compose config validation. Review is by the maintainer;
expect a few days.

### What gets a PR rejected

- Application behavior changes bundled into a "cleanup" PR
- New backend code that drops coverage below 90%, or frontend changes that drop
  coverage below the floors in `frontend/vitest.config.ts`
- Swapping tooling (package manager, formatter, test runner) without prior discussion
- Secrets, credentials, or real `.env` values in the diff
- Generated artifacts (`.next/`, `__pycache__/`, `*.db`, `node_modules/`) committed

## Releasing

Publishing container images is triggered by pushing a `v*` tag, not by merging
into `main`, and there is no floating `latest` image. To cut a release:

1. Move the `## [Unreleased]` heading in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD`,
   add a fresh empty `Unreleased` section above it, and add the compare/release
   link definitions at the foot of the file.
2. Confirm `make ci-local` passes.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The publish job builds and pushes images tagged by semver and `sha-<short>`,
   with provenance and an SBOM. Its summary prints each image's immutable
   `@sha256:` digest — record those in the release notes.

Do not date or link a changelog version before its tag is pushed: a changelog
that describes a release nobody can fetch, with links that 404, makes the whole
history untrustworthy.

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/chrysogonus/prompt-maker-studio/issues/new/choose).
For bugs, include reproduction steps, expected vs. actual behavior, and
whether you are running the Docker stack or local toolchains.

**Do not file security vulnerabilities as public issues** — follow
[SECURITY.md](./SECURITY.md) instead.

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, and you confirm you have the right to submit them.
