# Monitoring

The optional `monitoring` Compose profile runs pinned Prometheus 3.9.0 and Grafana
12.4.0 alongside the single backend. Prometheus scrapes `backend:8000/metrics`
every 15 seconds and keeps 30 days in `prometheus_data`. Grafana provisioning
and settings use `grafana_data`. Retention is time based; disk consumption still
depends on activity and label cardinality. Nothing starts by default, and no
external notification destination is provisioned.

## Operator access

After configuring `GRAFANA_ADMIN_PASSWORD` using the normal deployment procedure,
an operator can enable monitoring deliberately:

```bash
docker compose -f docker-compose.yml --profile monitoring up -d prometheus grafana
```

Prometheus binds only `127.0.0.1:9090`; Grafana binds only `127.0.0.1:3010`.
For a remote VM, forward these ports through an authenticated SSH session:

```bash
ssh -N -L 3010:127.0.0.1:3010 -L 9090:127.0.0.1:9090 operator@your-vm
```

Open [Grafana](http://localhost:3010) or [Prometheus](http://localhost:9090).
Grafana initially uses the `admin` account and the configured password.
The production Caddy configuration blocks public `/metrics` access. Keep these
ports on loopback; metrics contain operational information and Prometheus has
no configured authentication. Starting or changing production services is an
operator action; validation below does not start the deployed stack.

## Dashboards

All three provisioned dashboards default to the last 24 hours and refresh every
30 seconds. Follow the links at the top to switch views while retaining the time
picker and filters. The existing overview dashboard UID is retained on upgrades.
Edit the files under `monitoring/grafana/provisioning/` to change provisioned views.

| Dashboard | Answers |
|---|---|
| App Overview | Current accounts, prompts and pending ratings; signups, logins, prompt mutations and deletions in the selected period; operation/outcome/channel breakdowns, daily activity and scrape availability |
| AI & Evaluation | Explicit provider attempts, latency, returned tokens and estimated cost; whole-operation outcomes, case outcomes and pending human ratings |
| API Health | Exact statuses and route templates, request rates and overall latency, work in progress, process CPU/memory and snapshot freshness/errors |

`Job` and `Instance` scope every data query. `Operation / feature`, `Channel` and
`Provider` scope the applicable detail panels; each panel states exceptions.
Headline signup/login/mutation totals retain their named operation. Channels
apply to operation counts, while provider metrics and duration histograms do not
have a channel label. Evaluation case counters are aggregate across features and
providers. `All` features also includes calls outside a named operation (`other`).

Selected-period event totals use `increase(counter[$__range])`, while activity
charts use `increase(counter[$__interval])` for each displayed bucket. Daily
activity has a minimum one-day bucket; zoom out to compare days. Rates are
separate panels, labelled in requests per second. Current gauges do not use
`increase`. Latencies use histogram percentiles, with the high-resolution HTTP
histogram for overall API latency rather than mixing route-specific buckets.

Initialized, quiet operation/provider/case series yield zero activity. Unknown
series, insufficient samples, a missing target or an unavailable scrape yield
**No data**. Activity and current-value panels require all selected instances to
have a healthy current scrape; select an individual instance to inspect it when
one target is unavailable. The availability panel shows 1 for a healthy scrape,
0 for a failed scrape, and no series for a missing target/source. A stale database
snapshot can still have a healthy scrape: inspect snapshot age separately.
The HTTP 5xx zero fallback is anchored to real HTTP request samples, so a quiet
backend with no HTTP series remains distinct from observed traffic without errors.
The overview's active-operation table hides zero rows; an empty table with a
healthy scrape means no activity, while headline counters still show zero.

## Event semantics

Operations are counted once at their orchestration/service boundary after the
operation returns. Successful persisted mutations are counted after their
existing commit. A rollback does not become a successful mutation. Authentication,
request validation or rate-limit failures before that boundary remain HTTP
events and may have no corresponding operation event. REST and MCP use the same
business-operation boundary, distinguished by `channel="rest"` or `"mcp"`.

| Operation label | Completed action |
|---|---|
| `signup`, `login`, `account_delete` | Account creation, login attempt reaching the service, account deletion |
| `password_reset` | Attempt to complete a password reset using a token; success means the password change committed |
| `password_reset_email` | Actual password-reset email delivery attempt; `error` identifies a failed delivery |
| `prompt_create`, `prompt_update`, `prompt_duplicate`, `prompt_delete`, `prompt_restore` | Committed library mutation; duplicate is separate from create, restore is separate from update |
| `ai_import` | Importing text through the AI parser |
| `refine_questions`, `refine_draft` | Generating clarification questions or a draft; applying/saving it is a separate prompt mutation |
| `try_once` | One playground execution |
| `eval_generate`, `eval_run` | Generating evaluation cases or executing an evaluation run |
| `connection_test` | Testing the configured provider connection |

`pms_operations_total{operation,outcome,channel}` has four outcomes: `success`,
`rejected` (an expected domain rejection), `error` (an operational failure), and
`partial` (an evaluation with any execution or judge failure). HTTP 200 can
therefore accompany a partial evaluation. A poor score is not an operational
failure. `pms_operation_duration_seconds{operation}` measures the entire operation
and `pms_operations_in_progress{operation}` shows active work.

`pms_eval_cases_total{method,outcome}` distinguishes methods `rule`, `judge` and
`manual`, and outcomes `scored`, `pending_manual`, `execution_error` and
`judge_error`. A successfully scored low-quality answer still counts as `scored`.
Pending manual cases remain visible until rated; the current pending gauge
reflects persisted database state rather than all historical pending events.

Provider telemetry is separate from whole operations:

- `pms_llm_calls_total{feature,provider,outcome}` counts each explicit SDK create
  invocation as `success` or `error`. JSON compatibility fallbacks are additional
  calls; internal SDK retries are hidden. A returned response can be a successful
  provider call even if later parsing/validation makes the feature fail.
- `pms_llm_duration_seconds{feature,provider}` records each explicit call's duration.
- `pms_llm_tokens_total{feature,provider,direction}` records returned input/output
  token usage before parsing/validation. Missing usage contributes no token count.
- `pms_llm_estimated_cost_usd_total{feature,provider}` estimates cost from returned
  usage and cached/fallback pricing. Telemetry uses `refresh=False` and never
  waits for a pricing-network refresh. Missing usage/pricing makes totals incomplete; a
  zero-cost local provider can legitimately report zero. These estimates do not
  change existing billing/budget behavior or its conservative fallback estimates.
- `pms_llm_cost_estimation_errors_total` counts pricing calculation exceptions or
  unusable cost estimates (negative, non-finite or non-numeric)
  across all features/providers. Call and token telemetry remain intact when
  estimation fails. Unknown prices returning zero do not increment this counter.
- `pms_llm_usage_collection_errors_total` counts malformed token usage (negative,
  non-integer or boolean counts), across all features/providers. The explicit call
  remains counted; token and cost collection are skipped for that response.
  Missing usage is separate and does not increment this counter. The AI telemetry
  collection errors chart displays both global diagnostic counters independently
  of the feature/provider filters.

A forgot-password request is not a completed password reset. Unknown email
addresses deliberately do not produce a `password_reset_email` operation;
successful delivery is measured separately from successful token completion.

Metrics label only fixed operations, outcomes, channels, providers and methods.
Model names, identities, prompt IDs/content, URLs and error text are not labels.
HTTP labels retain exact numeric statuses and templated handlers.

## Snapshots, history and billing

`pms_accounts_current`, `pms_prompts_current` and
`pms_eval_pending_ratings_current` come from cached database aggregate queries.
Scrapes refresh them at most once every 30 seconds. A failed refresh retains the
previous values, increments `pms_snapshot_collection_errors_total`, and leaves
`pms_snapshot_last_success_timestamp_seconds` unchanged. Snapshot age therefore
reveals when an apparently valid current total has become stale.

Counters reset when the backend process restarts. Prometheus `increase` handles
observed resets, but cannot recover events between scrapes, during downtime or
before monitoring was enabled. It extrapolates sample boundaries, so period totals
are approximate and may be fractional before display rounding. Recently created
series need at least two samples. There is no historical backfill and these
metrics are not an audit ledger.

Account deletion reduces current account/prompt gauges and removes that account's
persisted billing rows under the existing deletion behavior. Sampled aggregate
provider telemetry remains in Prometheus until retention expires; deleting an
account does not subtract historical counters. Returned usage recorded before
validation can also appear in telemetry even when the business transaction fails.
Expect differences between provider telemetry, persisted spend and an invoice.

## Alert ownership and notifications

Prometheus evaluates the recording rules and the five alert conditions in
`monitoring/prometheus/rules.json`. Grafana-managed provisioned alerts query
Prometheus's firing `ALERTS` series and bridge it into Grafana Alerting. Thresholds
and waiting periods live only in Prometheus, avoiding duplicate condition logic
or a second waiting period. Prometheus has no Alertmanager destination configured.

| Alert | Condition / waiting period |
|---|---|
| `BackendUnavailable` | Failed scrape or absent backend target for 2 minutes |
| `SustainedServerErrors` | HTTP 5xx above 5%, at least 100 requests in 5 minutes, sustained for 5 minutes |
| `ProviderFailureRate` | Explicit provider errors above 10%, at least 20 calls per provider in 10 minutes, sustained for 5 minutes |
| `PasswordResetDeliveryFailures` | Observed failed delivery in the last 5 minutes; no additional waiting period |
| `SnapshotStale` | Last successful snapshot over 2 minutes old, sustained for 2 minutes |

Percentage rules require minimum traffic so one isolated failure does not page an
operator. Grafana evaluates bridges every 30 seconds; backend-source NoData and
query execution errors are alerting. Other bridges use OK for NoData because
their conditions depend on observed traffic. An observed `up` series supplies
normal zero bridge values; no blanket zero vector hides a missing target.

In Grafana **Alerting → Contact points**, configure your intended destination,
then add a notification policy matching `service=prompt-maker-studio`. Existing
contact points and policies are left untouched. Fresh Grafana instances have no
usable external destination supplied by this project; inspect any pre-existing
policy before enabling alerts. No notification was sent as part of implementation
or isolated validation. Alert files are immutable through the UI; change the
provisioning files and reload/restart Grafana through the normal operator procedure.
See [Grafana's provisioning reference](https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/file-provisioning/).

## Logs and validation

The backend writes structured JSON to stdout; Docker rotates logs at 10 MB with
three files. Request and operation events carry timestamp, level, logger, event,
request ID, operation/channel context, outcome, duration and bounded error type
where applicable. Access events carry route templates and status. Raw bodies,
query strings, IP addresses, provider error text and unsanitized tracebacks are
excluded from backend logs. There is no Loki/Alloy deployment or Grafana log
search; use the authenticated operator shell:

```bash
docker logs --since 1h prompt-maker-studio-backend
```

Root `/` and `/metrics` health/scrape requests are excluded from traffic metrics.
Request IDs connect related backend events without identifying a user. Retain
operator control over Docker log access and any exported diagnostics.

Static config tests run with the normal backend suite. To check Prometheus
syntax without starting the deployed stack:

```bash
docker run --rm --network none --entrypoint /bin/promtool \
  -v "$PWD/monitoring/prometheus:/etc/prometheus:ro" \
  prom/prometheus:v3.9.0@sha256:27343e8f1bb6555f50b561c758b53b5973a5a110a028d0457a90d4d33804b1b4 \
  check config /etc/prometheus/prometheus.yml
```

Prometheus semantic tests also exercise every dashboard query against a missing
source, initialized quiet series, failed scrapes, minimum-volume guards and firing
alerts. Run them in the same isolated image:

```bash
docker run --rm --network none --entrypoint /bin/promtool \
  -v "$PWD/monitoring/prometheus:/etc/prometheus:ro" \
  prom/prometheus:v3.9.0@sha256:27343e8f1bb6555f50b561c758b53b5973a5a110a028d0457a90d4d33804b1b4 \
  test rules /etc/prometheus/rules.test.json
```

For Compose validation, explicitly pass an empty temporary `--env-file` and
dummy required settings, rather than loading the operator's `.env`. Isolated
Grafana provisioning checks must use a disposable data directory/container and
no external network, preserving deployed dashboards, contacts and volumes.
