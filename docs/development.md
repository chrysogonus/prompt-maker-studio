# Development Quick Start

## Prerequisites
- Docker & Docker Compose (recommended)
- OR: Python 3.12 and Node.js 22 for local development (CI pins `node-version: '22'`; `frontend/.nvmrc` pins `22.14.0` for local version managers)

## Quickest Start (Docker)

```bash
make setup   # creates .env with a freshly generated SECRET_KEY
make up
```

The direct local frontend and backend ports work without further edits. Browser
API calls remain same-origin through the frontend proxy, so `CORS_ORIGINS` is
not involved. To test password-reset email links locally, set:

```ini
FRONTEND_URL=http://localhost:3000
```

The [Quick Start in `README.md`](../README.md#quick-start-with-docker) explains
the behavior. Then access the app at http://localhost:3000.

## Makefile Commands

All common tasks are available via Makefile:

```bash
make help          # Show all commands
make setup         # Create .env file with a generated SECRET_KEY
make install       # Install local dependencies (backend incl. dev tools, frontend)
make setup-venv    # Backend-only venv with dev tools (prerequisite for `make ci-local`)
make lock          # Regenerate backend/requirements*.lock after a dependency change
make build         # Build Docker images
make up            # Start with Docker
make down          # Stop Docker
make restart       # Restart containers (without rebuilding)
make sync-restart  # Rebuild images and restart (use after code changes)
make logs          # View logs
make clean         # Clean everything
make dev-backend   # Run backend locally
make dev-frontend  # Run frontend locally
make setup-e2e     # Install locked frontend dependencies and Playwright Chromium
make test-e2e      # Run browser E2E tests against isolated Compose services
```

**Key Distinction**:
- `make restart`: Simply restarts existing containers (fast, preserves images)
- `make sync-restart`: Stops, rebuilds images from source, then restarts (use when code changes need to be reflected in Docker)

## First Time Setup

### 1. Environment Setup
```bash
make setup
```

This copies `.env.example` to `.env` and generates a real `SECRET_KEY` for you.
It never touches an existing `.env`.

No edit is required for the default local stack. Set `FRONTEND_URL` as shown
under [Quickest Start](#quickest-start-docker) when testing reset emails.

There is no LLM API key in `.env` — AI access is bring-your-own. Register an
account, then connect a provider (OpenAI, Anthropic, Gemini, or a local Ollama
/ vLLM server) under Settings → API access. A local Ollama server is the
cheapest way to exercise the AI features while developing:

```
Provider:  Ollama (self-hosted)
Base URL:  http://localhost:11434/v1
Model:     llama3
API key:   (leave blank)
```

> If you copy `.env.example` by hand instead of running `make setup`, generate
> the signing key yourself with `openssl rand -hex 32`. The backend refuses to
> start while `SECRET_KEY` is a published placeholder or shorter than 32
> characters — that check exists because a public key makes every session token
> on the instance forgeable.

The root `.env` is Compose configuration and remains on the host. Local
non-Docker processes do not load it automatically, so use the scoped
environment setup below.

### 2. Backend Setup (Python 3.12)

Create the virtual environment at the repo root as `.venv` — this is the path the Makefile
targets (`lint-backend`, `test-cov`, `ci-local`, etc.) expect, so it stays usable by both
manual commands and `make`:

```bash
# Must be 3.12+ — a distro `python3` is often older (3.10 on Ubuntu 22.04) and
# the editable install will fail outright. `make install` picks a suitable
# interpreter for you.
python3.12 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r backend/requirements-dev.lock
pip install -e "backend/" --no-deps
```

### 3. Frontend Setup
```bash
cd frontend
npm install
```

## Running the Application

### Terminal 1 - Backend
```bash
source .venv/bin/activate
export SECRET_KEY="$(openssl rand -hex 32)"
# Optional: correct reset-email links during local SMTP testing
export FRONTEND_URL="http://localhost:3000"
make dev-backend
```
Backend: http://localhost:8000
API Docs: http://localhost:8000/docs

### Terminal 2 - Frontend
```bash
cd frontend
printf 'API_PROXY_TARGET=http://localhost:8000\n' > .env.local
npm run dev
```
Frontend: http://localhost:3000

`API_PROXY_TARGET` tells the Next dev server where to forward `/api`. The
browser only ever calls :3000, so local development is same-origin too and CORS
does not come into it.

## Quick Test

1. Open http://localhost:3000
2. Register a new account (username ≥ 3 chars, password ≥ 8 chars, valid email required) — you land on the **Dashboard**
3. Click **+ New prompt**, then add fields using **"+ Add Field"**:
   - Field name: `goal` / Content: `Create a fantasy character`
   - Field name: `style` / Content: `Epic and heroic`
4. Click **Generate Prompt**
5. See the XML-formatted prompt on the right
6. Click **Copy** to copy the prompt
7. Click **Save** and name it `Fantasy Template` — you're redirected to its Editor/Detail page
8. Click **Library** in the nav bar and click the card to reload it

## Project Structure Overview

```
prompt-maker-studio/
├── backend/              # FastAPI backend
│   ├── app/
│   │   ├── api/         # Endpoints
│   │   ├── services/    # Business logic
│   │   ├── models/      # Data models
│   │   └── database/    # DB config
│   └── run.py           # Start server
│
└── frontend/            # Next.js frontend
    ├── src/
    │   ├── app/         # Pages
    │   ├── components/  # UI components
    │   └── lib/         # API client
    └── package.json
```

## Common Tasks

### View Database (Docker)
```bash
# View all prompts (sqlite3 CLI not installed in slim image, use Python)
docker exec -it prompt-maker-studio-backend python -c "
import sqlite3, json
conn = sqlite3.connect('/app/data/prompts.db')
for row in conn.execute('SELECT id, user_id, fields, created_at FROM prompts'):
    print(row[0], row[1], json.loads(row[2]), row[3])
conn.close()
"

# Count prompts
docker exec -it prompt-maker-studio-backend python -c "
import sqlite3
conn = sqlite3.connect('/app/data/prompts.db')
print('Total prompts:', conn.execute('SELECT COUNT(*) FROM prompts').fetchone()[0])
conn.close()
"

# View table schema
docker exec -it prompt-maker-studio-backend python -c "
import sqlite3
conn = sqlite3.connect('/app/data/prompts.db')
for row in conn.execute('PRAGMA table_info(prompts)'):
    print(row)
conn.close()
"
```

### View Database (Local Development)
```bash
# If running locally without Docker and sqlite3 is installed
cd backend
sqlite3 prompts.db
.tables
SELECT id, user_id, fields, created_at FROM prompts;
.quit
```

### Clear Database (Docker)
```bash
# Remove the Docker volume
make down
docker volume rm prompt-maker_backend-data
make up  # Will recreate database
```

### Clear Database (Local Development)
```bash
# If running locally without Docker
cd backend
rm prompts.db
python run.py  # Will recreate tables
```

### Seed the demo account

For manual QA and demos, seed (or re-seed) a fully-populated `alex` account
(prompts across folders/tags, favorites, version history, and 30 days of
Playground runs so the Dashboard has real data):

```bash
make seed-demo-user
```

Safe to re-run — it replaces the account's data rather than duplicating it.

> **Local databases only.** The account is created with the fixed password
> `test1234`, which is published in this repository. The script refuses to run
> unless `SEED_DEMO_USER=1` is set, precisely so it cannot be run against a
> deployed instance by accident. If you ever do seed a shared database, delete
> the `alex` user immediately afterwards.

### Adding a New Prompt Field

The application uses **dynamic fields** — users can add any named field from the UI or API without code changes. No schema update is needed for new field types.

If you need to add a new **system-level** field (e.g. a required metadata field), update:
1. `backend/app/models/schemas.py` — add field to `PromptField` or `PromptRequest` validators
2. `backend/app/services/prompt_generator.py` — adjust generation logic if special-casing is needed
3. Update relevant tests in `backend/tests/`

## Troubleshooting

### Backend won't start
- Check Python version: `python --version`
- Activate virtual environment
- Reinstall dependencies: `make setup-venv` (installs from `backend/requirements-dev.lock`)

### Frontend won't start
- Check Node version: `node --version`
- Clear cache: `rm -rf .next node_modules`
- Reinstall: `npm install`

### CORS errors
Browser calls are same-origin (`/api` on the page's own host), so CORS should
not be reachable in either the Compose or the local topology. If you do see
one, something is calling the backend on a different origin — check for a
stray `NEXT_PUBLIC_API_URL` in `frontend/.env.local`, which overrides the
same-origin default.

### API calls 404 in local development
`frontend/.env.local` is missing `API_PROXY_TARGET=http://localhost:8000`, so
the Next dev server is forwarding `/api` to the Compose service name instead of
your local backend. Restart `npm run dev` after adding it.

### Intermittent 503s on `?_rsc=` requests
Next.js `<Link>` prefetches the React Server Component payload for a route as a
`GET /<route>?_rsc=<hash>` request. Occasional 503s on those — with the UI
recovering on the following full navigation and nothing in the console — do
**not** come from this application:

- Next.js' own server has no 503 code path (`grep -r 503 node_modules/next/dist/server`
  finds nothing); it answers a prefetch with 200, 404, or 500.
- The only 503s this codebase emits are `backend/app/api/admin_routes.py`'s
  admin guards, on `/api/admin/*` — never on a frontend route.

They come from whatever sits between the browser and the Next server: Caddy
answers `503` while `frontend:3000` is unreachable (recreated, rebuilt, or still
booting), and any other proxy in front of the app can do the same. If you see
them, check `docker compose ps`/`docker compose logs frontend` for a restart
around that timestamp rather than looking for an application bug. A burst of
700 RSC requests (sequential and 50-way concurrent, across `/library`,
`/editor/{id}`, `/playground/{id}`, and `/dashboard`) against a healthy stack
returns 200 every time.

## Testing

### Run All Tests
```bash
make test
```

### Run Tests with Coverage
```bash
make test-cov
# View HTML report: open backend/htmlcov/index.html
```

### Run Specific Test File
```bash
make test-file FILE=tests/test_api.py
```

**Test suites**: backend pytest (with a 90% coverage gate), frontend Vitest + React Testing Library, and Playwright browser tests covering registration, saving, editing/versioning, concurrent-edit handling, refinement history, eval workflows, settings/dashboard workflows, and accessibility across themes and pages. Exact counts are deliberately not listed here — they went stale within weeks last time; run `make test`, `make test-frontend`, and `make test-e2e` for current figures.

## Dependency Locks

`backend/requirements*.lock` are generated with `--generate-hashes`, and every
install path (`make install`, `make setup-venv`, CI, and the backend image) uses
`pip install --require-hashes`. A hash in the file that nothing verifies is
decoration, so the two go together.

Consequences worth knowing:

- Adding or changing a dependency means running `make lock` and committing both
  files. Hand-editing a version will fail the install, not just the gate.
- `pip` and `setuptools` are pinned in the dev lock (`--allow-unsafe`), so they
  are installed from it rather than upgraded separately — an unpinned upgrade
  alongside hashed installs would defeat the point.
- Base images are pinned by digest in the Dockerfiles and `docker-compose.yml`,
  with the readable tag kept in a comment. Dependabot's `docker` ecosystem
  updates both together.

## Code Style

### Python (Backend)
- Follow PEP 8
- Use type hints
- Write docstrings for public functions
- Keep functions small and focused

### TypeScript (Frontend)
- Use TypeScript strict mode
- Define interfaces for all data structures
- Use functional components
- CSS Modules for styling
