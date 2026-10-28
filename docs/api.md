# API Reference

The generated [OpenAPI documentation](http://localhost:8000/docs) describes
request and response schemas for a default local installation. This is a map
of the main routes; see the [README](../README.md#quick-start-with-docker) to
start the app.

All user-data endpoints require authentication. Public health (`GET /`),
OpenAPI (`GET /docs`, `/redoc`, `/openapi.json`), discovery and authentication
entry points, and the free-tool endpoints under `/api/public`, are exceptions; `/metrics` is an unauthenticated internal endpoint
blocked by the production Caddy configuration. Browsers use the httpOnly session
cookie set by `/api/auth/login` (plus an `X-CSRF-Token` header on writes);
scripts and CI can still send `Authorization: Bearer <token>`. See
[Authentication](authentication.md).

## Authentication Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | No | Register new user account |
| `POST` | `/api/auth/login` | No | Set the session/CSRF cookies; return token type and expiry metadata |
| `POST` | `/api/auth/refresh` | Yes | Renew a valid session within its 12-hour maximum age: a new session cookie, the same CSRF token |
| `POST` | `/api/auth/logout` | No | End the current session by clearing its cookies. Deliberately unauthenticated so signing out works with an already-expired token |
| `POST` | `/api/auth/logout-all` | Yes | Invalidate every session for this account, including the caller's |
| `GET` | `/api/auth/me` | Yes | Retrieve current user profile and settings |
| `PATCH` | `/api/auth/me` | Yes | Update `email`, `new_username`, or library/evaluation preferences; changed email requires `current_password` |
| `DELETE` | `/api/auth/me` | Yes | Delete user account and every row it owns. Requires the account password in the body |
| `GET` | `/api/auth/me/llm-connection` | Yes | Read the caller's LLM provider connection and the selectable-provider catalogue (never returns the API key) |
| `GET` | `/api/auth/me/llm-connection/models` | Yes | List curated OpenAI/Anthropic/Gemini models, or discover local/custom models, with estimated input/output pricing |
| `PUT` | `/api/auth/me/llm-connection` | Yes | Create or replace the connection; hosted models must be in the curated catalogue |
| `DELETE` | `/api/auth/me/llm-connection` | Yes | Disconnect the provider and erase the stored key |
| `POST` | `/api/auth/me/llm-connection/test` | Yes | Send a tiny probe to verify the configured endpoint, key, and model; an optional body with the `PUT` fields tests those unsaved values without storing them (omitting `api_key` reuses the stored key, only for the same provider; an empty string tests without a key) |
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
The response's `private_urls_allowed` reports whether the server accepts a base URL
that resolves to a private or loopback address (`ALLOW_PRIVATE_LLM_URLS`).

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
| `GET` | `/api/prompts/saved` | Yes | List the library (supports `folder` and `favorite_only` filters). Each prompt has `eval_status` (`untested`, `current` when a run tested its current text, `stale` when only other text was tested) and `eval_score` (the newest current run's score) |
| `GET` | `/api/prompts/folders` | Yes | Distinct folder names |
| `PATCH` | `/api/prompts/folders?name=` | Yes | Rename a folder for all its prompts (merges onto an existing name) |
| `DELETE` | `/api/prompts/folders?name=` | Yes | Remove a folder; its prompts become unfiled |
| `GET` | `/api/prompts/export` | Yes | Download every prompt with its version history and known-good version as JSON |
| `GET` | `/api/prompts/{id}` | Yes | Fetch one prompt |
| `PATCH` | `/api/prompts/{id}` | Yes | Update name, sections, folder, favorite, known-good version or variable metadata (section/metadata changes keep a version; notes describe the resulting state; supports optimistic locking). `known_good_version` names an existing version number, including one this request saves, and `0` clears it; marking keeps content and history unchanged (422 for a version that does not exist) |
| `DELETE` | `/api/prompts/{id}` | Yes | Permanently delete a prompt and its history |
| `POST` | `/api/prompts/{id}/duplicate` | Yes | Copy sections, folder, variable metadata, legacy tags and eval cases under a unique name; reset favorite and omit histories |
| `GET` | `/api/prompts/{id}/versions` | Yes | Version history |
| `POST` | `/api/prompts/{id}/versions/{version_id}/restore` | Yes | Restore a version (the replaced state becomes a version) |
| `POST` | `/api/prompts/refine/questions` | Yes | Ask clarifying questions about current editor `fields`; optional `force` |
| `POST` | `/api/prompts/refine/draft` | Yes | Revise current `fields` using `qa_pairs` (omit or send `[]` to improve without clarifications); returns validated section edits without saving. Optional `evidence` `{prompt_id, run_id, result_ids}` (1–5 IDs) names results from one of the caller's eval runs; the server loads their inputs, criteria, scores, feedback and trimmed outputs and gives them to the refiner as untrusted data (404 if any is not the caller's) |
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
`required: false`; an optional `example` is separate from section content, and optional
`options` (up to 50 strings of up to 200 characters, trimmed, without blanks or repeats) are
offered as a list in Fill mode. `options` is omitted when unset.
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
| `GET`, `POST` | `/api/prompts/{id}/eval/runs` | Yes | List runs (`limit` 1–100, default 50; `offset` ≥ 0) or run the suite. An optional POST body `{"fields": [...]}` tests those unsaved sections instead of the saved prompt and never saves them. Each run reports `tested_version` (the saved version with the tested text; `null` for an unsaved draft whose text was never saved) and `matches_current` (whether that text is the prompt's current text); `tested_prompt` is the text itself (`null` before migration 031) |
| `POST` | `/api/prompts/{id}/eval/runs/{run_id}/results/{result_id}/rate` | Yes | 1–5 star rating: scores a pending Manual result, or records `human_score` beside a scored AI-review result without changing its score. Either rating is final (404 once rated) |

## Public Endpoints

Used by the free tools for signed-out visitors; no session needed.

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/public/model-prices` | No | Curated hosted models (`provider`, `provider_label`, `id`, `label`) with estimated input/output prices per million tokens and `prices_as_of`, the ISO date the price was fetched from the live index or last checked for the built-in snapshot (null when unpriced) (60/min) |
| `GET` | `/api/public/refine` | No | Whether the free refiner is offered (`available`: `PUBLIC_REFINE_ENABLED` and a server default) and its `max_chars` (60/min) |
| `POST` | `/api/public/refine/questions` | No | Clarifying questions for a pasted prompt `{text, website, force}`; `website` is a honeypot that must be empty. Uses the server default; 404 when off, 503 without a server default, 402 when the shared or public monthly budget is used up, 429 at the daily or per-IP limit (`PUBLIC_REFINE_RATE_LIMIT`, default 6/minute and 30/day, shared with `/draft`) |
| `POST` | `/api/public/refine/draft` | No | A refined prompt `{text}` from `{text, website, qa_pairs}` (at most 5 pairs; blank answers are ignored), with the same limits. The refined text must keep the prompt's `{{variables}}` and tags |

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
