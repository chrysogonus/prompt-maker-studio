# Prompt Maker Studio Backend

The backend is a FastAPI application that owns authentication, prompt
persistence and versioning, provider-backed prompt workflows, evaluation,
analytics, spend controls, and operator diagnostics.

Use the [root README](../README.md) for the product overview and public API
summary. This document is a code map for backend contributors.

## Architecture

Requests follow the repository's route → service → model/database layering:

```text
backend/
├── app/
│   ├── api/          # FastAPI routers and request/response orchestration
│   ├── auth/         # JWT, password hashing, and auth dependencies
│   ├── database/     # SQLAlchemy connection and idempotent migration runner
│   ├── models/       # ORM entities and Pydantic boundary schemas
│   └── services/     # Business logic and external integrations
├── migrations/       # Historical SQL references; not executed directly
├── scripts/          # Demo seeding and cron-invoked weekly summaries
├── tests/            # pytest unit, component, and ASGI integration tests
├── pyproject.toml    # Dependencies and Ruff/Bandit/coverage configuration
└── run.py            # Uvicorn development entry point
```

`app/main.py` configures middleware, error handling, metrics, database startup,
and these router groups:

| Router | Prefix / responsibility |
|---|---|
| `auth_routes.py` | `/api/auth`: accounts, sessions, profiles, and password recovery |
| `routes.py` | `/api/prompts`: generation, persistence, versions, Playground, export, and capability config |
| `eval_routes.py` | Prompt-scoped evaluation cases, AI proposals, runs, history, CSV, and ratings |
| `refine_routes.py` | Prompt-scoped clarification questions and draft refinements |
| `analytics_routes.py` | `/api/analytics`: dashboard and usage aggregation |
| `admin_routes.py` | `/api/admin`: token-protected operator diagnostics |

FastAPI's generated `/docs` page and the
[root API overview](../README.md#api-reference-overview) are the endpoint
references; avoid duplicating a full endpoint inventory here.

## Service and Data Boundaries

- Prompt creation, compilation, versioning, and monotonic SQLite IDs live in
  the prompt services.
- LLM client construction is isolated in `services/llm_client.py`; parser,
  Playground, eval-generator, evaluator, and refiner services receive the
  acting user's connection. Every metered path checks `BudgetService` and
  records usage through `spend_ledger`.
- Evaluation cases, runs, and per-case results are durable records; evaluation
  workers do not use SQLAlchemy sessions outside the request thread.
- Users, prompts, prompt versions, Playground runs, eval records, billed calls,
  and the prompt-ID sequence are separate ORM models.
- Pydantic schemas in `app/models/schemas.py` validate API inputs and outputs.

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
  `app/database/migrations.py`; follow the
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
