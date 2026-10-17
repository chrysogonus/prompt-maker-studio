# Backend Tests

Every `test_*.py` module in this directory has a row below. `test_tests_readme_sync.py`
enforces that in both directions, so this table cannot silently drift.

| Module | Coverage area |
|---|---|
| `test_admin_routes.py` | Token-protected SMTP diagnostics |
| `test_application.py` | Application factory, startup lifecycle, and test initialization isolation |
| `test_api.py` | Section-based prompt creation, library and folder/favorite filters, updates, ownership, duplicate configuration/eval-case copying, permanent deletion, non-reused IDs, and Try once without persistence |
| `test_auth.py` | Registration, JWT lifecycle, profile, account deletion, password reset, password change, and the `SECRET_KEY` startup guard that rejects every published example key |
| `test_auth_cookies.py` | The browser session path: httpOnly session cookie, the readable CSRF cookie, double-submit CSRF enforcement on cookie-authenticated writes (and its bearer/safe-method exemptions), logout, and the `COOKIE_DOMAIN`/`COOKIE_SECURE` deployment settings |
| `test_auth_identity.py` | Immutable token subjects across renames, deletion and reused IDs; bcrypt byte limits, generic registration conflicts, and missing-user password verification |
| `test_failed_llm_billing.py` | Persisted provider usage after JSON/shape failures, retries, malformed output, and failed judge grading |
| `test_backup_restore.py` | Consistent SQLite backup and integrity-checked restore |
| `test_budget_service.py` | BudgetService global/per-user monthly spend-ceiling parsing, enforcement, and the config endpoint's remaining-budget snapshot |
| `test_database_connection.py` | SQLite engine PRAGMA configuration: WAL, busy timeout, and foreign-key enforcement |
| `test_docker_compose_config.py` | Compose service config: neither application container mounts `.env`, the backend database stays on its persistent volume, the legacy `OPENAI_API_KEY` is absent and documented settings are forwarded, local ports default to loopback, and the backup worker is non-root with a read-only database mount |
| `test_email_service.py` | SMTP configuration, TLS verification, and password-reset email delivery |
| `test_error_handling.py` | Request-id correlation middleware, sanitized request-validation logging, and the catch-all handler for unhandled (non-HTTPException) exceptions |
| `test_eval_generator_service.py` | EvalGeneratorService synthetic test-case proposal generation (standard, edge-case, adversarial, robustness, output-format) with a mocked provider connection and token/cost tracking |
| `test_eval_routes.py` | Eval case CRUD and caps, AI proposals, atomic CSV import/export, run creation/history pagination, manual ratings, ownership/cascade isolation, and budget-ceiling rejection |
| `test_eval_service.py` | EvalService rule/judge/manual scoring, aggregate computation, per-case PlaygroundRunError isolation, and run/result reproducibility metadata (resolved model, aggregate cost/latency/tokens, criteria/variables/judge-model snapshot) |
| `test_go_live_smoke.py` | Production readiness smoke coverage |
| `test_limiter.py` | Rate-limiter key function: per-client isolation, loopback fallback, and rejection of a client-supplied spoofed forwarding header |
| `test_llm_client.py` | The single provider-client construction seam: own-connection/server-default resolution, per-provider timeouts, the portable JSON-completion strategy (prompt-carried schema, capability-aware `response_format`, tolerant parsing, bounded retry, usage across attempts), and provider-neutral error mapping |
| `test_llm_connection_models.py` | Local/custom discovery, pricing, empty fallbacks, per-user TTL caching, and update/delete invalidation |
| `test_curated_models.py` | Hosted catalogue restrictions, choices before setup, rejection without credential changes, and legacy connection execution/update |
| `test_llm_connection_routes.py` | `/api/auth/me/llm-connection` GET/PUT/DELETE and its probe: provider switching, key retention/clearing, base-URL validation, per-user isolation, and assertions that the stored key never appears in a response body or log line |
| `test_llm_url_egress.py` | Egress policy for user-supplied provider base URLs: private, loopback, link-local, multicast, and cloud-metadata destinations are rejected after DNS resolution (every answer, not just the first), with the ALLOW_PRIVATE_LLM_URLS opt-in for self-hosted Ollama/vLLM |
| `test_llm_pricing.py` | LiteLLM provider/model normalization, per-token to per-million conversion, live/static/free pricing precedence, unknown prices, and stale-on-refresh-error cache behavior |
| `test_mcp_routes.py` | MCP prompt-library endpoint: bearer auth (missing, invalid, revoked tokens), the v1 tool list and annotations, save/list/get/update/version tools, per-user isolation, re-rendering on update, and stale-edit rejection |
| `test_metrics.py` | Operation outcomes/context cleanup, cached database snapshots, provider retries/usage and automatic-traffic exclusion |
| `test_operation_metrics.py` | Account/prompt operation boundaries, REST/MCP counting, rollback, password-reset delivery, connection-test failure and evaluation partial outcomes |
| `test_logging.py` | Structured JSON log redaction, HTTP/request correlation and runner logging configuration |
| `test_monitoring_config.py` | Provisioned dashboards, Prometheus rules and Grafana alert configuration contracts |
| `test_migrations.py` | SQLite migration upgrades and idempotency |
| `test_models.py` | User and prompt ORM models |
| `test_oauth.py` | OAuth account linking for MCP clients: discovery metadata, dynamic registration and its redirect-host allowlist, consent approve/deny, PKCE, single-use codes, audience-bound access tokens rejected by the REST API, refresh-token rotation, revocation, the `offline_access` scope, rate limits on registration/token/consent, and disconnection on sign-out-everywhere or account deletion |
| `test_oauth_revocation.py` | Client-specific access/refresh/code revocation, stale approvals after sign-out/password recovery, concurrent exchanges, atomic account-version increments, legacy tokens, and delayed revocation across reauthorization or account ID reuse |
| `test_optimistic_concurrency.py` | Conflict detection for concurrent prompt writes: `updated_at` advances even when the wall clock steps backwards or two writes land in one instant, and any difference from the client's token is a conflict (no tolerance window to lose an update in) |
| `test_playground.py` | Template variable compilation and PlaygroundService cost/latency math (the service evaluations run prompts through) |
| `test_prompt_parser.py` | Text-to-fields parser service (including non-strict-schema providers and fenced JSON) and the parse-text endpoint |
| `test_prompt_refiner.py` | PromptRefinerService question/draft calls and structural validation of section edits, variables and embedded tags |
| `test_prompt_sections.py` | Rendering sections to tagged text, display names with spaces, and recovering sections from text only when that round-trips exactly |
| `test_prompt_service.py` | Transport-independent prompt operations, ownership, versions, and failed-write rollback |
| `test_prompt_versions.py` | Version snapshotting on section/metadata edits, resulting-state notes and legacy notes, metadata restore semantics, ownership, and cascade delete |
| `test_prompts_config.py` | Per-user AI capability endpoint: connection state, model list, budget status, and per-user scoping |
| `test_refine_routes.py` | Saved-prompt and unsaved-snapshot refinement, authentication, section/answer validation, spend recording (including rejected drafts), separate save/versioning, and budget rejection |
| `test_safe_regex.py` | Time-bounded matching for user-supplied eval regexes: catastrophic patterns are abandoned within a fixed budget regardless of input length, the runaway worker is killed rather than merely abandoned, workers come from a fork server rather than a fork of the threaded server, the pool recovers, and `re` semantics (backreferences, lookaround) are preserved |
| `test_schemas.py` | Pydantic request and response validation, including `VariableMetadataItem`, eval case/rating, and refine draft schemas |
| `test_secret_store.py` | Fernet encryption of stored provider API keys: round-trip, non-determinism, key-rotation failure mode, and display masking |
| `test_seed_demo_user.py` | `backend/scripts/seed_demo_user.py` — the `SEED_DEMO_USER` opt-in guard, idempotent library/version seeding, clearing legacy run data, and complete model registration |
| `test_tests_readme_sync.py` | This table itself: every `test_*.py` module has a row, and no row names a deleted module |
| `test_user_preferences.py` | Settings preferences (library view, eval defaults) and the full data-export endpoint |

## Running Tests

Run these commands from the repository root:

```bash
make test
make test-cov
make test-file FILE=tests/test_api.py
```

For direct pytest use, activate the repository virtual environment and run from
`backend/`:

```bash
source ../.venv/bin/activate
pytest tests/test_auth.py -v
```

Dependencies are declared in `backend/pyproject.toml` and pinned transitively
in `backend/requirements.lock` (runtime) and `backend/requirements-dev.lock`
(runtime plus dev tooling). Regenerate both with `make lock` after changing a
dependency.

## Test Configuration

- `backend/pyproject.toml` is the single source of truth for pytest and
  coverage settings — discovery, verbose output, and the `unit`,
  `integration`, and `slow` markers. The former `pytest.ini` and `.coveragerc`
  shadowed it silently and were removed.
- `conftest.py` provides a temporary SQLite database, database session,
  FastAPI test client, and authenticated-user fixtures.
- CI and `make test-cov` enforce at least 90% backend coverage.

When adding a backend behavior, add focused tests in the matching existing
module or create a new `test_<feature>.py` module and update this table.
