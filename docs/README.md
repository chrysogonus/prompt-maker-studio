# Documentation

Reviewed against the codebase on 2026-10-28. **0.13.0** is the latest published
release. Publication, MCP Registry updates and production deployment are
separate operations.

## Start here

- [Project overview and Docker quick start](../README.md).
- [How it works](how-it-works.md): a plain-language, visual overview for newcomers and talks.
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

- [Deployment](deployment.md): upgrades, HTTPS, backup, restore and rollback, plus the
  [public pages](deployment.md#public-pages) every deployment serves (guides, tools, gallery,
  `/about`, `/llms.txt`), its legal pages and caching.
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
- [0.14.0 release candidate](releases/0.14.0.md): dependency updates for the backend,
  frontend and CI, and a visual how-it-works overview, with no feature or API changes.
- [0.13.0 release record](releases/0.13.0.md): one structured-data entity, a fuller
  About page, titles and sitemap dates for search, deeper gallery templates, sourced guides,
  dated token-counter prices, documentation synced with the code, immutable image digests
  and validation.
- [0.12.0 release record](releases/0.12.0.md): search and AI-assistant
  discoverability from the 2026-10-27 SEO audit, an About page, a ChatGPT and Claude
  connection guide, `llms.txt`, fuller gallery pages and guides, immutable image
  digests and validation.
- [0.11.0 release record](releases/0.11.0.md): AI answers rendered as Markdown,
  fixes from the 2026-10-26 UI/UX test and the design audit, dependency updates,
  immutable image digests and validation.
- [0.10.0 release record](releases/0.10.0.md): free no-login tools, guides, a template
  gallery and an optional free refiner, input choices, re-import and editor fixes from the
  2026-10-23 UI/UX test, immutable image digests and validation.
- [0.9.0 release record](releases/0.9.0.md): evaluation agreement, runs tied to the
  tested text, refinement from test results, known-good versions, the Claude connector,
  import fixes, immutable image digests and validation.
- [0.8.0 release record](releases/0.8.0.md): Notion and Obsidian import,
  ChatGPT connection settings, immutable image digests and validation.
- [0.7.0 release record](releases/0.7.0.md): public Terms of Service route,
  immutable image digests, validation and deployment requirements.
- [0.6.1 release record](releases/0.6.1.md): MCP annotation correction,
  verification, immutable image digests and publication results.
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
