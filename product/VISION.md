# Product Vision

> Last reviewed against the codebase: 2026-10-11 (0.3.0 redesign).

## One-liner
Prompt Maker Studio is a home for the prompts you keep retyping: save them as sections, mark the parts that change, and copy a filled-in version into any chat assistant whenever you need it.

## Problem Statement
People who use ChatGPT, Claude or Gemini every day rewrite the same prompts from memory or dig them out of old chats and notes. The good versions get lost, small improvements are not kept, and adapting a prompt to today's details means editing text by hand every time.

## Target Users
| Persona | Description | Primary Need |
|---|---|---|
| Frequent chat-assistant user | Writes prompts in ChatGPT, Claude or Gemini many times a week for work and personal tasks; comfortable with structure, not a prompt engineer | Keep the prompts that work, tweak them over time, and reuse them in seconds |
| ChatGPT plugin user | The same person working from inside ChatGPT, saving and fetching prompts through the MCP plugin | One library that the web app and ChatGPT both read and write |

Out of focus: complete newcomers who need guided prompt writing, and engineers who want an LLM workbench with evaluations and model runs.

## Value Proposition
A prompt is a short list of named sections with `{{variables}}`. The library keeps them organised in folders and favourites; the editor shows exactly what will be copied, fills in the variables, and keeps every saved version to compare or restore. Optional AI help imports an existing prompt or rough notes into sections.

## Success Metrics
- A saved prompt can be found, filled in and copied in under 15 seconds, including on a phone
- A new structured prompt can be written and saved in under 2 minutes, from scratch, a starter template, or pasted text
- What the editor previews, what the ChatGPT plugin saves, and what is copied never disagree
- Earlier versions of a prompt are always one click from comparison and restore
- Nothing in the app looks precise without being true (no estimated tokens, no vanity analytics)

## Non-Goals (Out of Scope)
- Running prompts or comparing models inside the app; people run prompts in their chat assistant (the deferred evaluation engine is the exception, if it returns)
- Operator-funded model access; the optional AI connection is the user's own provider or an operator-configured default
- Team collaboration or sharing; each account is a private library
- Guaranteeing prompt quality

## Tech Stack Summary
- **Backend**: FastAPI (Python), SQLAlchemy, SQLite, JWT authentication, SlowAPI rate limiting, bring-your-own LLM provider over an OpenAI-compatible transport
- **Frontend**: Next.js 16, React 18, TypeScript
- **Infrastructure**: Docker, Docker Compose, Caddy reverse proxy with automatic TLS and security headers
- **Security tooling**: Bandit, pip-audit, npm audit, Ruff, and ESLint
- **Monitoring**: Prometheus (FastAPI instrumentation), Grafana dashboards
