# Product Vision

> Last reviewed against the codebase: 2026-07-26.

## One-liner
Prompt Maker Studio helps developers and AI practitioners create, test, evaluate, refine, and reuse structured prompts in one private workspace.

## Problem Statement
Creating high-quality prompts for LLMs is repetitive and inconsistent. Without a dedicated workflow, prompts get rewritten from scratch, changes are hard to compare, and quality judgments are disconnected from the template that produced an output. Users need a guided path from rough idea to structured prompt, plus a reliable way to test, evaluate, refine, version, and retrieve it.

## Target Users
| Persona | Description | Primary Need |
|---|---|---|
| Developer / AI practitioner | Technical user building prompts for personal or professional LLM workflows | Quickly create and iterate on structured, reusable prompts |
| Prompt hobbyist | Non-expert user exploring AI capabilities | A simple UI that guides them to well-structured prompts without needing to know XML or prompt engineering conventions |
| Individual contributor | User maintaining a personal prompt library for repeatable work | Retrieve, test, and improve previously working prompts rather than starting fresh |

## Value Proposition
Prompt Maker Studio reduces the effort of going from idea to a validated, reusable prompt. Users can compose named fields, import free-form text, generate consistent XML, catch structural problems before execution, connect their own hosted or self-hosted LLM provider, test templates against real models, create repeatable eval sets manually or with AI assistance, compare results and versions, and accept AI-assisted refinements — all in one authenticated, persistent workspace.

## Success Metrics
- A structured prompt can be created from scratch in under 2 minutes
- Users can import free-form text and receive meaningful structured fields in a single action
- Saved prompts reduce prompt re-work across sessions
- Prompt history gives users a trail to recover and reuse past work
- Generated XML is immediately usable in other LLM tools without manual reformatting
- Evaluation history makes prompt-quality changes measurable across versions
- AI-assisted eval proposals reduce the effort required to establish useful happy-path, edge-case, and adversarial coverage
- Preflight feedback catches unresolved inputs and structural mistakes before users spend time or API budget on a run
- Playground analytics expose reliability, latency, token use, and cost instead of relying on guesswork
- Users can run every AI-assisted workflow through their own provider connection without depending on an operator-funded API key

## Non-Goals (Out of Scope)
- It does not provide operator-funded model access; each user connects their own hosted or self-hosted provider, and hosted credentials are stored encrypted for that account
- It does not integrate provider-native SDKs; providers must expose an OpenAI-compatible chat-completions endpoint
- It is not a team collaboration or prompt-sharing platform; each account has an isolated personal workspace
- It does not guarantee prompt quality; refinement is advisory and evaluations depend on user-configured cases and scoring methods

## Tech Stack Summary
- **Backend**: FastAPI (Python), SQLAlchemy, SQLite, JWT authentication, SlowAPI rate limiting, bring-your-own LLM provider over an OpenAI-compatible transport
- **Frontend**: Next.js 16, React 18, TypeScript
- **Infrastructure**: Docker, Docker Compose, Caddy reverse proxy with automatic TLS and security headers
- **Security tooling**: Bandit, pip-audit, npm audit, Ruff, and ESLint
- **Monitoring**: Prometheus (FastAPI instrumentation), Grafana dashboards
