# API Reference

The generated [OpenAPI documentation](http://localhost:8000/docs) describes
request and response schemas for a default local installation. This is a map
of the main routes; see the [README](../README.md#quick-start-with-docker) to
start the app.

All data endpoints require authentication. Browsers use the httpOnly session
cookie set by `/api/auth/login` (plus an `X-CSRF-Token` header on writes);
scripts and CI can still send `Authorization: Bearer <token>`. See
[Authentication](authentication.md).

## Authentication Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | No | Register new user account |
| `POST` | `/api/auth/login` | No | Authenticate user and issue JWT token |
| `POST` | `/api/auth/refresh` | Yes | Renew valid JWT token (sliding session) |
| `POST` | `/api/auth/logout` | No | End the current session by clearing its cookies. Deliberately unauthenticated so signing out works with an already-expired token |
| `POST` | `/api/auth/logout-all` | Yes | Invalidate every session for this account, including the caller's |
| `GET` | `/api/auth/me` | Yes | Retrieve current user profile and settings |
| `PATCH` | `/api/auth/me` | Yes | Update profile email, username, or settings preferences |
| `DELETE` | `/api/auth/me` | Yes | Delete user account and every row it owns. Requires the account password in the body |
| `GET` | `/api/auth/me/llm-connection` | Yes | Read the caller's LLM provider connection and the selectable-provider catalogue (never returns the API key) |
| `GET` | `/api/auth/me/llm-connection/models` | Yes | List models exposed by the caller's provider with estimated input/output pricing; Anthropic uses its static compatibility list |
| `PUT` | `/api/auth/me/llm-connection` | Yes | Create or replace the provider, base URL, model, and API key |
| `DELETE` | `/api/auth/me/llm-connection` | Yes | Disconnect the provider and erase the stored key |
| `POST` | `/api/auth/me/llm-connection/test` | Yes | Send a tiny probe to verify the configured endpoint, key, and model |
| `POST` | `/api/auth/change-password` | Yes | Change password after verifying current password; revokes all other sessions |
| `POST` | `/api/auth/forgot-password` | No | Initiate password reset email flow |
| `POST` | `/api/auth/reset-password` | No | Complete password reset using token; revokes every session |

## Prompt Endpoints

Prompt text is always rendered by the server from the prompt's sections (`fields`); requests that send `generated_prompt` are rejected.

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/prompts` | Yes | Save a new prompt from a name, sections, optional folder and variable hints |
| `POST` | `/api/prompts/parse-text` | Yes | Split pasted text into sections with the caller's AI connection (Import text) |
| `GET` | `/api/prompts/config` | Yes | The caller's AI connection state, model list, and budget status |
| `GET` | `/api/prompts/saved` | Yes | List the library (supports `folder` and `favorite_only` filters) |
| `GET` | `/api/prompts/folders` | Yes | Distinct folder names |
| `PATCH` | `/api/prompts/folders?name=` | Yes | Rename a folder for all its prompts (merges onto an existing name) |
| `DELETE` | `/api/prompts/folders?name=` | Yes | Remove a folder; its prompts become unfiled |
| `GET` | `/api/prompts/export` | Yes | Download every prompt with its version history as JSON |
| `GET` | `/api/prompts/{id}` | Yes | Fetch one prompt |
| `PATCH` | `/api/prompts/{id}` | Yes | Update name, sections, folder, favorite or hints (content changes keep a version; supports optimistic locking) |
| `DELETE` | `/api/prompts/{id}` | Yes | Permanently delete a prompt and its history |
| `POST` | `/api/prompts/{id}/duplicate` | Yes | Duplicate a prompt |
| `GET` | `/api/prompts/{id}/versions` | Yes | Version history |
| `POST` | `/api/prompts/{id}/versions/{version_id}/restore` | Yes | Restore a version (the replaced state becomes a version) |
| `POST` | `/api/prompts/refine/questions` | Yes | Ask clarifying questions about current editor `fields`; optional `force` |
| `POST` | `/api/prompts/refine/draft` | Yes | Revise current `fields` using `qa_pairs`; returns validated section edits without saving |
| `POST` | `/api/prompts/{id}/refine/questions`, `/refine/draft` | Yes | Retained saved-prompt refinement API; draft returns text |

## Evaluation Endpoints

The evaluation UI uses these endpoints for saved prompts. Runs use the latest saved content.

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET`, `POST` | `/api/prompts/{id}/eval/cases` | Yes | List or create evaluation cases |
| `PATCH`, `DELETE` | `/api/prompts/{id}/eval/cases/{case_id}` | Yes | Modify or delete a case |
| `GET` | `/api/prompts/{id}/eval/cases/export` | Yes | Export test cases as CSV |
| `POST` | `/api/prompts/{id}/eval/cases/import` | Yes | Import test cases from CSV |
| `POST` | `/api/prompts/{id}/eval/cases/generate` | Yes | Propose reviewable AI test cases |
| `GET`, `POST` | `/api/prompts/{id}/eval/runs` | Yes | List runs or run the suite |
| `POST` | `/api/prompts/{id}/eval/runs/{run_id}/results/{result_id}/rate` | Yes | Manual 1–5 star rating |

## MCP, OAuth & Admin Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/mcp` | Yes | MCP server exposing the library as tools (see [docs/mcp.md](mcp.md)) |
| `POST` | `/api/oauth/register`, `/api/oauth/token`, `/api/oauth/revoke` | No | OAuth 2.1 endpoints MCP clients such as ChatGPT use to link an account (see [docs/mcp.md](mcp.md)) |
| `GET` | `/api/oauth/authorize` | No | Start of the OAuth flow; redirects to the consent page |
| `GET`, `POST` | `/api/oauth/consent` | Yes | Consent-screen details and the user's allow/deny decision |
| `POST` | `/api/admin/smtp/check` | Admin Token | Validate SMTP connectivity (requires `X-Admin-Token` header) |

