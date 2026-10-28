# Product Vision

> Last reviewed against the codebase: 2026-10-28 (latest published release 0.12.0).

## One-liner
Prompt Maker Studio is a home for the prompts you keep retyping: save them as sections, mark the parts that change, and copy a filled-in version into any chat assistant whenever you need it.

## Problem Statement
People who use ChatGPT, Claude or Gemini every day rewrite the same prompts from memory or dig them out of old chats and notes. The good versions get lost, small improvements are not kept, and adapting a prompt to today's details means editing text by hand every time.

## Target Users
| Persona | Description | Primary Need |
|---|---|---|
| Frequent chat-assistant user | Writes prompts in ChatGPT, Claude or Gemini many times a week for work and personal tasks; comfortable with structure, not a prompt engineer | Keep the prompts that work, tweak them over time, and reuse them in seconds |
| ChatGPT or Claude connector user | The same person working from inside ChatGPT or Claude, saving and fetching prompts through the MCP connector | One library that the web app and the assistant both read and write |
| Signed-out visitor | Arrives from a search or an AI assistant looking for a prompt template, a guide or a quick tool | A useful answer without an account (free tools, templates, guides), and a reason to keep their prompts here |

Out of focus: a general-purpose chat client or developer LLM workbench. Optional one-off tests and saved-prompt evaluations support improving reusable templates.

## Value Proposition
A prompt is a short list of named sections with `{{variables}}`. The library keeps them organised in folders and favourites; the editor shows exactly what will be copied, fills in the variables, and keeps every saved version to compare or restore. Optional AI help converts a pasted prompt into sections and variables, refines wording through questions and reviewable diffs, and tests saved versions against reusable examples. Apply/Undo and Save remain separate, explicit actions.

## Success Metrics
- A saved prompt can be found, filled in and copied in under 15 seconds, including on a phone
- A new structured prompt can be written and saved in under 2 minutes, from scratch, a starter template, or pasted text
- What the editor previews, what the ChatGPT or Claude connector saves, and what is copied never disagree
- Earlier versions of a prompt are reachable through Tools → History for comparison and restore
- Nothing in the app looks precise without being true: estimates, such as the free token counter's, say they are estimates and how current their prices are; no vanity analytics

## Non-Goals (Out of Scope)
- A standalone Playground or multi-model comparison workbench; Try once and explicit saved-prompt evaluations are available to check a template
- Bundled model access; AI uses the user's provider or an optional operator-configured default, funded by whoever owns that connection
- Team collaboration or sharing; each account is a private library
- Guaranteeing prompt quality

## Tech Stack Summary
- **Backend**: FastAPI (Python), SQLAlchemy, SQLite, JWT authentication, SlowAPI rate limiting, bring-your-own LLM provider over an OpenAI-compatible transport
- **Frontend**: Next.js 16, React 18, TypeScript
- **Infrastructure**: Docker, Docker Compose, Caddy reverse proxy with automatic TLS and security headers
- **Security tooling**: Bandit, pip-audit, npm audit, Ruff, and ESLint
- **Monitoring**: Optional Prometheus HTTP/application/provider metrics, three provisioned Grafana dashboards and alerts, structured JSON logs
