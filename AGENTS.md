# prompt-maker-studio — agent operating notes

FastAPI backend (`backend/`) + Next.js frontend (`frontend/`), Docker/Compose behind Caddy.
The backend calling a user's own LLM provider via `backend/app/services/llm_client.py` is a
**product feature**, unrelated to this agent-operating layer.

## Where things are already documented

Go to the source; don't re-derive or duplicate it here.

| Need | Where |
|---|---|
| Architecture, API endpoints, tech stack | `README.md` |
| Contributor conventions (branches, commits, PRs, coding standards) | `CONTRIBUTING.md` |
| Local dev setup | `docs/development.md` |
| Deployment (VM, Docker, Caddy, backups) | `docs/deployment.md` |
| Docker Compose details | `docs/docker.md` |
| CI pipeline | `.github/CI_PIPELINE.md` |
| Auth system | `docs/authentication.md` |
| Saved-prompts feature | `docs/saved-prompts.md` |
| What's already built | `product/FEATURES.md` — check before calling something new |
| Why past decisions were made | `product/DECISIONS.md` — check before re-litigating |
| Vision / roadmap / backlog | `product/VISION.md`, `product/ROADMAP.md`, `product/BACKLOG.md` |

Stack conventions: `backend/AGENTS.md`, `frontend/AGENTS.md`. Step-by-step playbooks (new
endpoint, DB migration) live in `.claude/skills/` — check there before deriving a procedure.
Keep instruction content in `AGENTS.md`; the `CLAUDE.md` files are symlinks.

## Definition of done

- backend change → `make lint-backend && make test`
- frontend change → `make lint-frontend && make test-frontend`
- touches both, or before considering any larger change complete → `make ci-local`

`make help` lists every target. CI enforces a 90% backend coverage gate — new backend code
needs tests.

## Repository etiquette

Branch from `main` as `feat|fix|ref|docs|chore/short-description`. Commits follow Conventional
Commits (`fix(auth): reject expired reset tokens`). Full rules in `CONTRIBUTING.md`.

## Guardrails

- **YOU MUST NOT read, print, write, or edit `.env`** — it holds `SECRET_KEY`,
  `LLM_ENCRYPTION_KEY`, SMTP creds, and the Grafana admin password. This applies to `.env`
  only; `.env.example` is a checked-in template and is fine to edit.
- **Never deploy or publish without explicit user confirmation.**
- Keep diffs minimal and coherent — don't opportunistically restructure code you happened to
  touch. Other coding standards: `CONTRIBUTING.md`.
