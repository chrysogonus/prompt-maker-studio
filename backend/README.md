# Prompt Maker Studio Backend

The backend is a FastAPI application that owns authentication, prompt
persistence and versioning, rendering prompt text from sections, the MCP and
OAuth endpoints, optional AI import and refinement, evaluation, spend controls,
and operator diagnostics. Saved prompts have an explicit evaluation workspace
in the frontend; there is no standalone Playground route.

Use the [root README](../README.md) for the product overview and the
[API reference](../docs/api.md) for routes. This document is a code map for
backend contributors.

## Architecture

Requests follow the repository's route → service → model/database layering:

```text
backend/
├── app/
│   ├── api/          # FastAPI routers and request/response orchestration
│   ├── auth/         # JWT, password hashing, and auth dependencies
│   ├── database/     # SQLAlchemy connection and idempotent migration runner
│   ├── models/       # ORM entities
│   ├── schemas/      # Domain-specific Pydantic request/response models
│   └── services/     # Business logic and external integrations
├── migrations/       # Historical SQL references; not executed directly
├── scripts/          # Demo-account seeding
├── tests/            # pytest unit, component, and ASGI integration tests
├── pyproject.toml    # Dependencies and Ruff/Bandit/coverage configuration
└── run.py            # Uvicorn development entry point
```

`app/main.py` exposes `create_app()` and initializes the database during the
application lifespan. `app/http.py` configures middleware, error handling and
metrics. `app/logging_config.py` supplies structured, redacted logging.
The factory assembles these router groups:

| Router | Prefix / responsibility |
|---|---|
| `auth_routes.py` | `/api/auth`: assembles session, account, LLM-connection and password routers |
| `routes.py` | `/api/prompts`: create, library, folders, versions, import, Try once, export, and capability config |
| `mcp_routes.py` | `/api/mcp`: the library as MCP tools for ChatGPT and other clients |
| `oauth_routes.py` | Consent routes and authorization-server discovery; mounts MCP SDK OAuth protocol handlers at `/api/oauth` |
| `eval_routes.py` | Prompt-scoped evaluation cases, AI proposals, runs, CSV, and ratings |
| `refine_routes.py` | Clarification questions and draft refinements |
| `admin_routes.py` | `/api/admin`: token-protected operator diagnostics |

FastAPI's generated `/docs` page and the
[API reference](../docs/api.md) are the endpoint
references; avoid duplicating a full endpoint inventory here.

## Service and Data Boundaries

- REST and MCP share prompt operations in `services/prompts/`; neither transport
  calls the other. `services/accounts/` owns registration, profile, connection
  and password-recovery operations; `services/evaluation/` owns case persistence,
  CSV import/export and rating/history access. Expected operation failures are
  translated by each transport.
- A prompt's sections (`fields`) are the only content clients write;
  `services/prompt_sections.py` renders `generated_prompt` from them on every
  write and recovers sections from older text. Versioning and monotonic SQLite
  IDs live beside it in the prompt services.
- LLM client construction is isolated in `services/llm_client.py`; the parser
  and Try once, retained Playground execution, eval-generator, evaluator, and refiner
  services receive a resolved `LLMConnection` (own connection first, then the
  optional operator server default). Every metered path checks `BudgetService` and
  records usage through `spend_ledger`.
- Evaluation cases, runs, and per-case results are durable records; evaluation
  workers do not use SQLAlchemy sessions outside the request thread.
- Users, prompts, prompt versions, Playground runs (kept for evaluations), eval
  records, billed calls, OAuth records, and the prompt-ID sequence are separate
  ORM models. `models/__init__.py` registers and re-exports every model; add new
  entities there so relationship names resolve for scripts as well as the API.
- Pydantic schemas in `app/schemas/` validate API inputs and outputs.

The complete implemented-feature map is maintained in
[`product/FEATURES.md`](../product/FEATURES.md), and architectural rationale is
recorded in [`product/DECISIONS.md`](../product/DECISIONS.md).

## Contributor Conventions

- Keep route handlers thin: validate and authorize at the boundary, then
  delegate business logic to services.
- Scope prompt-owned data through the shared ownership dependency so missing
  and unowned records both return 404.
- Map expected external-service failures explicitly and preserve request IDs on
  unexpected 500 responses.
- Never edit a running database manually. Schema changes go through
  `app/database/migrations/runner.py`; follow the
  [migration guide](migrations/README.md).
- Add focused tests for new behavior and keep the module table in
  [tests/README.md](tests/README.md) synchronized.

Repository and backend-specific agent rules live in
[`AGENTS.md`](../AGENTS.md) and [`backend/AGENTS.md`](AGENTS.md).

## Development and Verification

Run routine commands from the repository root:

```bash
make dev-backend
make lint-backend
make test
make test-cov
make test-file FILE=tests/test_eval_service.py
make build-backend
```

The backend requires Python 3.12 or newer. Setup, environment configuration,
and troubleshooting are documented in
[`docs/development.md`](../docs/development.md); authentication details are in
[`docs/authentication.md`](../docs/authentication.md).
