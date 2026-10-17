# Documentation

Reviewed against the codebase on 2026-10-17. **0.6.0** is the latest published
release. Publication, MCP Registry updates and production deployment are
separate operations.

## Start here

- [Project overview and Docker quick start](../README.md).
- [Local development](development.md): toolchains, Make targets and tests.
- [Contributing](../CONTRIBUTING.md): conventions, quality gates and releases.
- [Docker](docker.md): services, profiles and configuration.
- [Configuration template](../.env.example): supported settings and defaults.

## Application and API

- [Saved prompts](saved-prompts.md): sections, variables, draft recovery,
  versions, refinement and evaluation.
- [REST API](api.md): routes, contracts, limits and errors. The running backend
  serves interactive OpenAPI documentation at `/docs`.
- [Authentication](authentication.md): cookies, CSRF, account security,
  session renewal and provider connections.
- [MCP](mcp.md): library tools, OAuth linking and client compatibility.
- [Shared rendering contract](../contracts/README.md): frontend/backend fixtures.
- Stack implementation notes: [backend](../backend/README.md),
  [frontend](../frontend/README.md), [backend tests](../backend/tests/README.md)
  and [migrations](../backend/migrations/README.md).

## Operations

- [Deployment](deployment.md): upgrades, HTTPS, backup, restore and rollback.
- [Monitoring](monitoring.md): HTTP/application/provider metrics, three Grafana
  dashboards, alerts and safe structured logs.
- [CI pipeline](../.github/CI_PIPELINE.md) and
  [branch protection](../.github/BRANCH_PROTECTION.md).
- [Security](../SECURITY.md), [licensing](licensing.md) and
  [third-party notices](../THIRD_PARTY_NOTICES.md).

## Product and release state

- [Implemented features](../product/FEATURES.md): current supported behavior.
- [Vision](../product/VISION.md), [user stories](../product/USER-STORIES.md),
  [roadmap](../product/ROADMAP.md) and [backlog](../product/BACKLOG.md).
- [Decision log](../product/DECISIONS.md): accepted choices and explicitly
  superseded history.
- [Changelog](../CHANGELOG.md): pending and published release changes.
- [0.6.0 release record](releases/0.6.0.md): publication, immutable image digests,
  verification and upgrade requirements.
- Earlier release records: [0.5.1](releases/0.5.1.md), [0.5.0](releases/0.5.0.md),
  [0.4.0](releases/0.4.0.md), [0.3.0](releases/0.3.0.md).

## Historical implementation records

[Repository refactoring](refactoring.md) and the completed plans/specification
under [`superpowers/`](superpowers/) describe their implementation snapshots.
Their commands, source paths, test totals and session constraints are historical;
use the current guides above for today's behavior and verification commands.

Agent instructions live in the root and stack `AGENTS.md` files; their
`CLAUDE.md` counterparts remain symlinks. Repository playbooks live under
[`.claude/skills/`](../.claude/skills/).
