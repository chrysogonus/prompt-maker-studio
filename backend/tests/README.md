# Backend Tests

Every `test_*.py` module in this directory has a row below. `test_tests_readme_sync.py`
enforces that in both directions, so this table cannot silently drift.

| Module | Coverage area |
|---|---|
| `test_admin_routes.py` | Token-protected SMTP diagnostics |
| `test_analytics.py` | Dashboard usage-analytics aggregation: month-over-month change, success rate, 7-day request volume, top prompts, per-user isolation, per-prompt run counts, and the weekly-summary digest |
| `test_api.py` | Prompt generation, saved prompts (incl. folder/tag/favorite filters), history, pagination, search, updates, ownership, real per-prompt run counts, and variable_metadata |
| `test_auth.py` | Registration, JWT lifecycle, profile, account deletion, password reset, password change, and the `SECRET_KEY` startup guard that rejects every published example key |
| `test_auth_cookies.py` | The browser session path: httpOnly session cookie, the readable CSRF cookie, double-submit CSRF enforcement on cookie-authenticated writes (and its bearer/safe-method exemptions), logout, and the `COOKIE_DOMAIN`/`COOKIE_SECURE` deployment settings |
| `test_backup_restore.py` | Consistent SQLite backup and integrity-checked restore |
| `test_budget_service.py` | BudgetService global/per-user monthly spend-ceiling parsing, enforcement, and the config endpoint's remaining-budget snapshot |
| `test_database_connection.py` | SQLite engine PRAGMA configuration: journal_mode=WAL and busy_timeout |
| `test_docker_compose_config.py` | Compose service config: neither application container mounts `.env`, the backend database stays on its persistent volume, no operator-wide provider API key is passed in, local ports default to loopback, and the backup worker is non-root with a read-only database mount |
| `test_email_service.py` | SMTP configuration, reset-email delivery, run-failure email, weekly-summary email, eval-run-complete email, and eval-score-regression email |
| `test_error_handling.py` | Request-id correlation middleware, sanitized request-validation logging, and the catch-all handler for unhandled (non-HTTPException) exceptions |
| `test_eval_generator_service.py` | EvalGeneratorService synthetic test-case proposal generation (standard, edge-case, adversarial, robustness, output-format) with a mocked provider connection and token/cost tracking |
| `test_eval_routes.py` | Eval case CRUD, run creation (rule/judge/manual scoring), run history, manual star ratings, completion/regression email hooks, and budget-ceiling rejection |
| `test_eval_service.py` | EvalService rule/judge/manual scoring, aggregate computation, per-case PlaygroundRunError isolation, and run/result reproducibility metadata (resolved model, aggregate cost/latency/tokens, criteria/variables/judge-model snapshot) |
| `test_go_live_smoke.py` | Production readiness smoke coverage |
| `test_limiter.py` | Rate-limiter key function: per-client isolation, loopback fallback, and rejection of a client-supplied spoofed forwarding header |
| `test_llm_client.py` | The single provider-client construction seam: connection resolution per user, per-provider timeouts, the portable JSON-completion strategy (prompt-carried schema, capability-aware `response_format`, tolerant parsing, bounded retry, usage across attempts), and provider-neutral error mapping |
| `test_llm_connection_models.py` | Authenticated live model catalogue: provider listing, pricing enrichment, static/empty fallbacks, Anthropic compatibility behavior, per-user TTL caching, and update/delete invalidation |
| `test_llm_connection_routes.py` | `/api/auth/me/llm-connection` GET/PUT/DELETE and its probe: provider switching, key retention/clearing, base-URL validation, per-user isolation, and assertions that the stored key never appears in a response body or log line |
| `test_llm_url_egress.py` | Egress policy for user-supplied provider base URLs: private, loopback, link-local, multicast, and cloud-metadata destinations are rejected after DNS resolution (every answer, not just the first), with the ALLOW_PRIVATE_LLM_URLS opt-in for self-hosted Ollama/vLLM |
| `test_llm_pricing.py` | LiteLLM provider/model normalization, per-token to per-million conversion, live/static/free pricing precedence, unknown prices, and stale-on-refresh-error cache behavior |
| `test_metrics.py` | Prometheus business metrics, read through `collect()` rather than library internals |
| `test_migrations.py` | SQLite migration upgrades and idempotency |
| `test_models.py` | User and prompt ORM models |
| `test_optimistic_concurrency.py` | Conflict detection for concurrent prompt writes: `updated_at` advances even when the wall clock steps backwards or two writes land in one instant, and any difference from the client's token is a conflict (no tolerance window to lose an update in) |
| `test_playground.py` | Template variable compilation, PlaygroundService cost/latency math, the Playground run endpoint (success, failure, ownership, validation, budget-ceiling rejection), and the run-history endpoint (pagination, ownership, failed runs) |
| `test_prompt_generator.py` | XML prompt generation |
| `test_prompt_parser.py` | Text-to-fields parser service (including non-strict-schema providers and fenced JSON) and the parse-text endpoint |
| `test_prompt_refiner.py` | PromptRefinerService clarifying-question and draft-generation calls |
| `test_prompt_versions.py` | Version snapshotting on edit, restore semantics, ownership, cascade delete, run_count passthrough |
| `test_prompts_config.py` | Per-user AI capability endpoint: connection state, model list, budget status, and per-user scoping |
| `test_refine_routes.py` | Refine tab clarifying-questions and draft endpoints, the accept-as-new-version flow, and budget-ceiling rejection |
| `test_safe_regex.py` | Time-bounded matching for user-supplied eval regexes: catastrophic patterns are abandoned within a fixed budget regardless of input length, the runaway worker is killed rather than merely abandoned, the pool recovers, and `re` semantics (backreferences, lookaround) are preserved |
| `test_schemas.py` | Pydantic request and response validation, including `VariableMetadataItem`, eval case/rating, and refine draft schemas |
| `test_secret_store.py` | Fernet encryption of stored provider API keys: round-trip, non-determinism, key-rotation failure mode, and display masking |
| `test_seed_demo_user.py` | `backend/scripts/seed_demo_user.py` — the `SEED_DEMO_USER` opt-in guard, idempotent demo-account seeding, and its downstream analytics |
| `test_tests_readme_sync.py` | This table itself: every `test_*.py` module has a row, and no row names a deleted module |
| `test_user_preferences.py` | Settings preferences (notifications, library view, eval defaults), the Playground run-failure email hook, and the full data-export endpoint |
| `test_weekly_summary_script.py` | `backend/scripts/send_weekly_summary_email.py`'s opt-in filtering and per-user failure isolation |

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
