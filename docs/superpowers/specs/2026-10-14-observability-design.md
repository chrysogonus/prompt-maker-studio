# App observability

> Historical implementation record. This work is complete and was included in
> a published release. Session constraints and verification totals below refer
> to that implementation; use the [current documentation index](../../README.md)
> for current behavior and commands.

The accepted scope is metrics refactoring, three provisioned Grafana dashboards,
and structured Docker logs. Keep the existing monitoring profile opt-in. No
deployment, commits, new dependencies, database schema changes, Loki or Alloy.
Work on dev, as required for the ongoing refactoring.

## Measurements

Use pms_operations_total{operation,outcome,channel}, operation duration histograms
and in-progress gauges. Channels are rest and mcp. Count each operation at one
orchestration/service boundary, after return; committed mutations finish after
their existing commit. Outcomes are success, rejected, error and partial.
Dependency/validation/rate-limit failures before that boundary remain HTTP events.
Refinement questions and draft generation are distinct from applying/saving.
An evaluation is partial when any case execution or judge fails, regardless of
HTTP status. A poor score is not an operational error. Manual ratings remain pending.

Provider attempts, returned token usage and estimated cost are separate from
feature operations. Instrument each SDK create invocation, including explicit
JSON fallback attempts; SDK-internal retries are not individually visible.
Count returned usage before parsing/validation. Do not change billing semantics.
Cost telemetry uses cached/fallback pricing without network refreshes. Malformed
token usage is skipped with a diagnostic counter, preserving the original response.
Pass request/operation context into evaluation workers with copy_context.

Current accounts, prompts and pending ratings are gauges from cached database
aggregate queries, refreshed on /metrics at most once every 30 seconds. Failed
refreshes retain previous values and expose freshness and collection errors.
Use existing get_db dependency so isolated tests do not query operator data.

Only fixed operation, provider, method, outcome and channel values are labels.
Never use identities, prompt IDs/content, URLs, model names or error text as labels.
Initialize fixed operation combinations to zero so quiet dashboards remain usable.
History is sampled telemetry, not an audit ledger; no synthetic backfill.

## HTTP and logs

Exclude / and /metrics from traffic metrics. Keep exact HTTP status labels and
route templates. Use the high-resolution histogram for overall API percentiles.
Generate and reset request ID/channel ContextVars at the ASGI boundary. JSON logs
include timestamp, level, logger, event, request ID, operation, channel, outcome,
duration and bounded error type. Never emit raw request bodies, URL query strings,
IP addresses, provider error text or unsanitized exception tracebacks. Uvicorn
access logs get a structured route/status record without sensitive URL fields.
Exception diagnostics retain only class and safe module/function/line locations.

## Operator views

App Overview: period event counts, current totals, daily trends, operation/channel
breakdowns, availability and errors. AI & Evaluation: feature/provider activity,
latencies, tokens/estimated costs, case outcomes and pending manual ratings.
API Health: exact statuses, templated routes, rates, percentiles, in-progress work,
process resources and snapshot health. Filters use job and instance; dashboard
defaults last 24h and refreshes every 30s. No-data stays distinct from zero.

Prometheus keeps 30 days, scrapes every 15s and includes recording/alert rules.
Grafana provisions alerts for missing/unavailable backend, sustained server errors,
provider failures and password-reset delivery failures. Percentage alerts require
minimum traffic. Notifications require operator-configured contact points; do not
send anything in this session. Keep loopback access and existing volumes.

## Verification

Regression tests cover commits/rollbacks, rejected login/signup/deletion, REST/MCP
counting, context cleanup/concurrency, invalid AI responses with usage, evaluation
partial outcomes and worker context, snapshots/freshness, log redaction and quiet
dashboards. Validate Prometheus rules with promtool, Grafana provisioning in an
isolated container, backend lint/tests and make ci-local. All operator .env files
remain unread and unchanged; CI commands receive an empty temporary env file.
