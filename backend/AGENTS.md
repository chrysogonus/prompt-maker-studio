# backend/ — agent operating notes

FastAPI. Layering is `api/` → `services/` → `models/` → `database/`; route handlers stay thin
and delegate to `services/`. Use the `add-api-endpoint` skill for new routes.

**LLM calls go through `services/llm_client.py` and nowhere else.** It is the single place an `OpenAI(...)` client is constructed, resolving the acting user's own bring-your-own provider connection. Services take an `LLMConnection` argument; they never read credentials from the environment. Anything needing JSON back uses `json_completion()`, which handles the fact that `response_format` is not portable across OpenAI-compatible endpoints. See `product/DECISIONS.md`, "Bring-Your-Own LLM Provider over an OpenAI-Compatible Transport".

**No Alembic.** Schema changes go through the idempotent runner in `app/database/migrations.py`, not migration-tool commands or raw SQL against a live DB. The numbered `.sql` files in `backend/migrations/` are historical references only, not directly executed. See `backend/migrations/README.md` for the full mechanism and the production migration checklist. Use the `db-migration` skill when making a schema change.

Don't hand-format — run `make lint-backend`, or `make lint-fix` to auto-fix (ask before running `lint-fix`, since it mutates source files). `pyproject.toml` is the single source of truth for Ruff, pytest, and coverage settings; there is no `pytest.ini` or `.coveragerc`.

Dependencies are declared in `backend/pyproject.toml` and locked transitively in `backend/requirements.lock` (runtime, used by the Dockerfile) and `backend/requirements-dev.lock` (adds dev tooling, used by CI and `make setup-venv`). After changing any dependency, run `make lock` and commit both lock files with the change.
