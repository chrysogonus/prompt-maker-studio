# App Observability Implementation Plan

> For agentic workers: execute the scoped tasks below, using parallel agents for
> disjoint file ownership. No commits or deployment.

**Goal:** Give operators a clean, accurate aggregate view of app activity and failures.
**Architecture:** Shared operation instrumentation and provider telemetry feed
Prometheus. Database snapshots expose current totals. Provisioned Grafana views
and JSON Docker logs support investigation.
**Tech Stack:** Existing FastAPI, prometheus-client, SQLAlchemy, stdlib logging,
Prometheus and Grafana; no added dependencies.
**Spec:** ../specs/2026-10-14-observability-design.md

## Constraints

Work on dev. Preserve unrelated work. Never read/edit .env. Do not commit, publish
or deploy. Keep external API behavior, billing and database schema unchanged.

## Review focus

Rollback must not emit success; REST and MCP must count once. HTTP 200 may contain
evaluation/provider failure. JSON retries may consume tokens before validation
fails. Failed snapshots must retain values and show stale status. Logs must never
include identities, raw exception messages or URL queries.

## Tasks

- [x] Metrics foundation and LLM transport (root): replace app/metrics.py with
  bounded operation metrics, observe_operation(name) sync decorator, operation(name)
  context manager yielding mutable outcome/error_type state, request_id_context,
  channel_context and operation_context ContextVars; refresh_snapshot(db, force=False).
  Add provider_attempt(connection) context yielding usage state, reporting tokens
  and cost even on format failure. Instrument llm_client SDK calls centrally.
  Write failing regressions before implementation; run test_metrics.py and LLM tests.
- [x] Business instrumentation: decorate shared account/prompt mutation boundaries
  and AI route orchestration once; remove old business counters. Instrument eval
  cases after commit, classify partial runs without parsing user-visible strings,
  propagate context to workers. Cover commits/rejections/MCP/eval failures with tests.
- [x] Structured logs and HTTP: add stdlib JSON formatter and runner logging config;
  reset request context in finally, sanitize access logs, exclude automatic traffic,
  exact status labels, snapshot-aware existing /metrics route. Cover redaction and
  correlation with tests. No edits to metrics.py or business services.
- [x] Dashboards/config/docs: replace overview, add AI/evaluation and API dashboards,
  recording and alert rules, Grafana alert provisioning, 30-day retention and
  15-second scrapes. Document event semantics, operator access and rollout limits.
  Add static configuration tests and validate actual promtool/Grafana containers.
- [x] Integration: review all diffs, run lint-backend and test, run ci-local with
  COMPOSE_ENV_FILES pointing to an empty temporary file, validate isolated monitoring
  and fix regressions. Report results and deployment status.

## Verification record

- `make lint-backend`: passed on final source.
- `make test`: 802 tests passed before final review additions.
- `make ci-local`: passed using an empty temporary Compose env file; included
  265 frontend unit tests, 30 browser tests, Docker smoke/image checks and notices.
- Final `make test-cov` after review fixes: 818 tests passed, 96.93% coverage.
- Native `promtool check config` and `promtool test rules`: passed.
- Disposable Grafana 12.4 loaded all three dashboards and five file-provisioned alerts.
- Disposable backend image: signup 201, metrics 200, matching correlation header,
  valid JSON stdout, one signup operation and one HTTP event; no identity in logs.
- Review findings fixed: telemetry pricing reads cached rates without network
  refresh/lock waits; malformed token usage cannot replace a completed response.
  Scoped re-review found no additional actionable issues.
- All disposable containers removed. Existing stack unchanged. No commits or deployment.
