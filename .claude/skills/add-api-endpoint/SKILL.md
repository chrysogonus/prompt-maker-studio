---
name: add-api-endpoint
description: Add a new backend API endpoint to Prompt Maker Studio, following the repo's existing route/service/schema layering. Use when asked to add, create, or expose a new backend endpoint or API route.
---

# Add a backend API endpoint

Follow this order — each step depends on the last:

1. **Schema** — add or extend the Pydantic request/response models in the matching domain module under `backend/app/schemas/` (e.g. `prompts.py` or `accounts.py`). Reuse existing field-validation patterns in that module (e.g. unique-name validation) rather than inventing new ones.
2. **Route** — add the endpoint in the appropriate router file under `backend/app/api/` (`routes.py` for prompt endpoints, `session_routes.py`, `account_routes.py`, `password_routes.py`, or `llm_connection_routes.py` for auth, `eval_routes.py` for evaluations, `refine_routes.py` for refinement, `admin_routes.py` for admin-only). Keep the handler thin: parse/validate via the schema, call a service function, return its result. Apply the existing auth dependency pattern (`backend/app/auth/dependencies.py`) if the endpoint should require authentication — check how neighboring endpoints in the same file do it. Register a new router in `backend/app/main.py` when needed.
3. **Service logic** — put any real logic in `backend/app/services/` (new file or extend an existing one), not in the route handler. If the endpoint touches the database, follow the ownership-scoping pattern in `services/prompts/ownership.py` (`get_owned_prompt`); use `OperationError` in services and `call_service` in HTTP adapters to translate expected service failures at the HTTP boundary. REST and MCP share prompt services; MCP calls those services directly and maps failures to tool errors. Keep ownership checks in the shared operation. Resolve AI calls through `api/deps.get_llm_connection` / `services/llm_client.py`, with the existing budget and spend-ledger handling.
4. **Tests** — add tests in `backend/tests/` (there's already a `test_api.py` / `test_auth.py` / `test_admin_routes.py` split by router — put new tests in the matching file, or create a new one if the endpoint doesn't fit any existing file). Cover: happy path, validation failure (422), auth failure if applicable, and ownership isolation if the endpoint is user-scoped. Update the module table in `backend/tests/README.md` when adding a test file.
5. **Document the contract** — update `docs/api.md` for public route changes. **Update `product/FEATURES.md`** — add or edit a row in the relevant table with the feature name, status, one-line description, and the file(s) it's implemented in. This file is the project's source-of-truth feature list and is easy to forget.
6. **Verify** — run `make lint-backend && make test` before considering the work done.
