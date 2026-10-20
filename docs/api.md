# API Reference

The generated [OpenAPI documentation](http://localhost:8000/docs) describes
request and response schemas for a default local installation. This is a map
of the main routes; see the [README](../README.md#quick-start-with-docker) to
start the app.

All user-data endpoints require authentication. Public health (`GET /`),
OpenAPI (`GET /docs`, `/redoc`, `/openapi.json`), discovery and authentication
entry points are exceptions; `/metrics` is an unauthenticated internal endpoint
blocked by the production Caddy configuration. Browsers use the httpOnly session
cookie set by `/api/auth/login` (plus an `X-CSRF-Token` header on writes);
scripts and CI can still send `Authorization: Bearer <token>`. See
[Authentication](authentication.md).

## Authentication Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | No | Register new user account |
| `POST` | `/api/auth/login` | No | Set the session/CSRF cookies; return token type and expiry metadata |
| `POST` | `/api/auth/refresh` | Yes | Renew a valid session and rotate cookies, within its 12-hour maximum age |
| `POST` | `/api/auth/logout` | No | End the current session by clearing its cookies. Deliberately unauthenticated so signing out works with an already-expired token |
| `POST` | `/api/auth/logout-all` | Yes | Invalidate every session for this account, including the caller's |
| `GET` | `/api/auth/me` | Yes | Retrieve current user profile and settings |
| `PATCH` | `/api/auth/me` | Yes | Update `email`, `new_username`, or library/evaluation preferences; changed email requires `current_password` |
| `DELETE` | `/api/auth/me` | Yes | Delete user account and every row it owns. Requires the account password in the body |
| `GET` | `/api/auth/me/llm-connection` | Yes | Read the caller's LLM provider connection and the selectable-provider catalogue (never returns the API key) |
| `GET` | `/api/auth/me/llm-connection/models` | Yes | List curated OpenAI/Anthropic/Gemini models, or discover local/custom models, with estimated input/output pricing |
| `PUT` | `/api/auth/me/llm-connection` | Yes | Create or replace the connection; hosted models must be in the curated catalogue |
| `DELETE` | `/api/auth/me/llm-connection` | Yes | Disconnect the provider and erase the stored key |
| `POST` | `/api/auth/me/llm-connection/test` | Yes | Send a tiny probe to verify the configured endpoint, key, and model |
| `GET` | `/api/auth/me/connected-apps` | Yes | List the MCP clients (such as ChatGPT) that still hold a valid connection to the caller's account: `[{client_id, name}]` |
| `DELETE` | `/api/auth/me/connected-apps/{client_id}` | Yes | Disconnect one client (10/min): its access and refresh tokens stop working at once; 404 if it is not connected to the caller |
| `POST` | `/api/auth/change-password` | Yes | Change password after verifying current password; revokes all other sessions |
| `POST` | `/api/auth/forgot-password` | No | Initiate password reset email flow |
| `POST` | `/api/auth/reset-password` | No | Complete password reset using token; revokes every session |

Anthropic connections accept optional `workspace_id` (`wrkspc_` followed by
letters/digits). Omitting it preserves a same-provider value; null clears it.
Changing provider or disconnecting clears it. Responses include this identifier,
never the API key. The shared client sends `anthropic-workspace-id` only for an
Anthropic connection targeting `api.anthropic.com` and does not follow redirects
with that header. Single-workspace keys can leave it empty. Connection testing
is explicit and may incur provider charges.

The connection response's `providers[].models` contains ordered model objects
(`id`, human-readable `label`, `input_price_per_1m`, `output_price_per_1m`).
OpenAI, Anthropic and Gemini return their curated choices even before a connection
is saved. `suggested_models` remains an ID-only view of the same registry.
Local/custom providers return an empty `models` array and allow manual model names;
the `/models` endpoint discovers their advertised models, cached per user for
15 minutes, and falls back to an empty array when discovery fails. Unknown prices
are `null`, while Ollama/vLLM prices are zero. Prices are estimates, not quotes.

Saving an unlisted hosted model returns HTTP 422. Existing connections using older
models remain readable, testable and runnable until explicitly changed; they are
not added to the selectable catalogue. Updating such a connection requires choosing
a current model. Omit `api_key` to keep the saved credential. Server defaults and
historical usage records are unaffected by the selection restriction.

## Prompt Endpoints

Prompt text is always rendered by the server from the prompt's sections (`fields`); requests that send `generated_prompt` are rejected.

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/prompts` | Yes | Save a new prompt from a name, sections, optional folder and variable metadata (hints, required inputs and examples) |
| `POST` | `/api/prompts/parse-text` | Yes | Convert pasted text into sections; optional `extract_variables: true` also returns original input values and source phrases |
| `POST` | `/api/prompts/try` | Yes | Run filled editor `text` once with the configured AI connection; records spend without saving a prompt |
| `GET` | `/api/prompts/config` | Yes | The caller's effective AI connection (own or server default, flagged by `uses_server_default`), suggested models, and shared/caller budget status |
| `GET` | `/api/prompts/saved` | Yes | List the library (supports `folder` and `favorite_only` filters) |
| `GET` | `/api/prompts/folders` | Yes | Distinct folder names |
| `PATCH` | `/api/prompts/folders?name=` | Yes | Rename a folder for all its prompts (merges onto an existing name) |
| `DELETE` | `/api/prompts/folders?name=` | Yes | Remove a folder; its prompts become unfiled |
| `GET` | `/api/prompts/export` | Yes | Download every prompt with its version history as JSON |
| `GET` | `/api/prompts/{id}` | Yes | Fetch one prompt |
| `PATCH` | `/api/prompts/{id}` | Yes | Update name, sections, folder, favorite or variable metadata (section/metadata changes keep a version; notes describe the resulting state; supports optimistic locking) |
| `DELETE` | `/api/prompts/{id}` | Yes | Permanently delete a prompt and its history |
| `POST` | `/api/prompts/{id}/duplicate` | Yes | Copy sections, folder, variable metadata, legacy tags and eval cases under a unique name; reset favorite and omit histories |
| `GET` | `/api/prompts/{id}/versions` | Yes | Version history |
| `POST` | `/api/prompts/{id}/versions/{version_id}/restore` | Yes | Restore a version (the replaced state becomes a version) |
| `POST` | `/api/prompts/refine/questions` | Yes | Ask clarifying questions about current editor `fields`; optional `force` |
| `POST` | `/api/prompts/refine/draft` | Yes | Revise current `fields` using `qa_pairs` (omit or send `[]` to improve without clarifications); returns validated section edits without saving |
| `POST` | `/api/prompts/{id}/refine/questions`, `/refine/draft` | Yes | Retained saved-prompt refinement API; draft returns text |

For `PATCH`, null values leave fields unchanged; use `folder: ""` to unfile
and `variable_metadata: {}` to clear variable settings. `fields` replaces the
whole section list. `last_updated_at` is optional in REST; when supplied, it
must exactly match the last `updated_at` (or `created_at` if null), otherwise the
request returns 409. The MCP update tool requires this token. REST library
results are ordered by creation time; the frontend sorts by content edit time or
title and applies search locally. `content_updated_at` records section/variable
edits and restores; when null, creation time is the content recency. Rename,
favorite and filing changes advance `updated_at` for concurrency without changing
`content_updated_at`. Migration 028 backfills historical content recency from the
last known update because earlier organization-only activity cannot be separated.

`parse-text` defaults to the existing fields-only response. Extraction responses
contain `fields` and `variables` with `name`, `value`, `description` and
`source_text`; an existing unfilled placeholder has an empty value and null
source text. Conversion never saves a prompt. Variable metadata defaults to
`required: false`; an optional `example` is separate from section content.
Prompt responses expose `current_note`; history exposes corrected `note` and
preserved `legacy_note`.

## Evaluation Endpoints

These endpoints power the saved-prompt evaluation workspace at
`/editor/{id}/evaluate`, opened from Tools → Evaluate. Runs use the latest saved
content and start only on explicit action; AI proposals are reviewed and
saved through case creation rather than persisted by generation.

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET`, `POST` | `/api/prompts/{id}/eval/cases` | Yes | List or create evaluation cases |
| `PATCH`, `DELETE` | `/api/prompts/{id}/eval/cases/{case_id}` | Yes | Modify or delete a case |
| `GET` | `/api/prompts/{id}/eval/cases/export` | Yes | Export test cases as CSV |
| `POST` | `/api/prompts/{id}/eval/cases/import` | Yes | Import test cases from CSV |
| `POST` | `/api/prompts/{id}/eval/cases/generate` | Yes | Propose reviewable AI test cases |
| `GET`, `POST` | `/api/prompts/{id}/eval/runs` | Yes | List runs (`limit` 1–100, default 50; `offset` ≥ 0) or run the suite |
| `POST` | `/api/prompts/{id}/eval/runs/{run_id}/results/{result_id}/rate` | Yes | 1–5 star rating: scores a pending Manual result, or records `human_score` beside a scored AI-review result without changing its score. Either rating is final (404 once rated) |

## MCP, OAuth & Admin Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/mcp` | Yes | MCP server exposing the library as tools (see [docs/mcp.md](mcp.md)) |
| `POST` | `/api/oauth/register`, `/api/oauth/token`, `/api/oauth/revoke` | No | OAuth 2.1 endpoints MCP clients such as ChatGPT use to link an account (see [docs/mcp.md](mcp.md)) |
| `GET` | `/api/oauth/authorize` | No | Start of the OAuth flow; redirects to the consent page |
| `GET`, `POST` | `/api/oauth/consent` | Yes | Consent-screen details and the user's allow/deny decision |
| `POST` | `/api/admin/smtp/check` | Admin Token | Validate SMTP connectivity (requires `X-Admin-Token` header) |

OAuth protocol handlers and MCP are mounted ASGI applications and do not appear
in the generated OpenAPI schema. Discovery endpoints are documented in
[MCP](mcp.md).

Expected failures use HTTP `detail`: 401 for invalid sessions, 403 for CSRF or
closed registration, 404 for missing/unowned prompt data, 409 for edit conflicts,
and 422 for invalid input or unusable AI configuration. Metered paths can return
402 for exhausted budgets/provider quota and 502 for provider failures. The
app's budget rejections also include a `budget` object with `scope` (`shared` or
`user`), `resets_at` (UTC), `retry_after` seconds and `reason` (`exhausted` or
`estimated_cost_exceeds_remaining`), plus a `Retry-After` header. Provider quota
errors need not include this metadata. `/api/prompts/config` reports shared and
caller exhaustion through `budget_exhausted`, `budget_scope`, `budget_resets_at`,
`global_budget_remaining_usd` and `user_budget_remaining_usd`. An estimated batch
can exceed the remaining budget before the balance is fully exhausted.
The connection probe returns 200 with an `ok` flag and message for probe failures.
Unexpected 500 responses contain a safe message and `request_id`; responses also
carry `X-Request-ID` for log correlation.
