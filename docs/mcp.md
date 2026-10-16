# MCP Endpoint (ChatGPT Integration)

`POST /api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes a user's saved-prompt library as tools. It is the backend for the ChatGPT
integration: ChatGPT writes and refines the prompt text in conversation, and
these tools store and retrieve it. Nothing on this endpoint calls an LLM, so users need
no provider connection to use it.

It is mounted inside the existing FastAPI app (`backend/app/api/mcp_routes.py`) and
runs in stateless, JSON-response mode, so each request is independent.

## Tools

| Tool | Read-only | REST equivalent |
|---|---|---|
| `list_saved_prompts` | Yes | `GET /api/prompts/saved` (summaries only, no prompt text; filter by `folder` or `favorite_only`) |
| `get_prompt` | Yes | `GET /api/prompts/{id}`, including each variable's hint in `variable_metadata` |
| `save_prompt` | No | `POST /api/prompts` |
| `update_prompt` | No | `PATCH /api/prompts/{id}` |
| `list_prompt_versions` | Yes | `GET /api/prompts/{id}/versions` |

The tools call shared operations in `backend/app/services/prompts/`, as do the
REST handlers. Ownership checks, section rules, text rendering, version snapshots
and edit-conflict detection are shared. REST maps operation failures to HTTP
errors (404 for missing or unowned prompts); MCP maps them to tool errors. The server renders the prompt text from the
fields for both, and `update_prompt` always requires `last_updated_at`. Field names
may contain spaces ("Output format"); they become tags such as `<OUTPUT_FORMAT>`.

### Contract changes in 0.3.0

Clients that cached the 0.2.0 tool schemas should refresh them:

- `list_saved_prompts` no longer accepts `tag`, and its summaries no longer include
  `tags`. Tags were retired from the product; stored tags remain in the data export.
- `get_prompt` and the save/update results no longer include `tags` or `run_count`.
- `save_prompt` and `update_prompt` accept field names with spaces, and reject two
  names that render to the same tag (`Role`/`role`).

`save_prompt` accepts a name and complete section list. `update_prompt` accepts
a prompt ID, required `last_updated_at`, and optional complete replacement
`fields`, `name`, and `note`. Folder/favorite/variable-metadata edits remain on
the REST API; the MCP detail responses include existing variable metadata.
`list_saved_prompts` wraps summaries in `prompts`; `list_prompt_versions` wraps
history in `versions` and excludes the current state. Listing follows creation
time, newest first.

Delete and version restore are intentionally not exposed.

## Authentication

ChatGPT links a user's account through this backend's own OAuth 2.1 authorization
server (`backend/app/services/oauth_provider.py`, built on the MCP SDK's handlers):

1. An unauthenticated call to `/api/mcp` returns `401` with
   `WWW-Authenticate: Bearer resource_metadata="<FRONTEND_URL>/.well-known/oauth-protected-resource/api/mcp"`.
2. That document names the issuer `<FRONTEND_URL>/api/oauth`, whose metadata is at
   `/.well-known/oauth-authorization-server/api/oauth`.
3. The client registers itself at `/api/oauth/register` (dynamic client registration).
   Its redirect URIs must be on a host in `OAUTH_REDIRECT_HOSTS` (default `chatgpt.com`)
   or loopback, so a look-alike app cannot use the consent screen to collect codes.
4. `/api/oauth/authorize` validates the request (PKCE `S256` is required) and redirects
   the browser to the frontend's `/oauth/authorize` page with the request signed into a
   15-minute JWT. The user signs in or creates an account there, then allows or denies.
5. Allowing issues a one-time code (5 minutes), which the client exchanges at
   `/api/oauth/token` for a 1-hour access token and a 30-day refresh token. Refresh
   tokens rotate on every use.

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource/api/mcp` | Protected-resource metadata (RFC 9728) |
| `GET /.well-known/oauth-authorization-server/api/oauth` | Authorization-server metadata (RFC 8414) |
| `POST /api/oauth/register` | Dynamic client registration (RFC 7591) |
| `GET /api/oauth/authorize` | Start of the authorization-code flow |
| `POST /api/oauth/token` | Code and refresh-token exchange |
| `POST /api/oauth/revoke` | Token revocation (RFC 7009) |
| `GET`, `POST /api/oauth/consent` | Consent-screen details and decision (session-authenticated) |

Revoking either an OAuth access token or refresh token disconnects that
account/client pair immediately: existing access tokens, refresh tokens and
pending authorization codes stop working. Other clients and accounts remain
connected. Reauthorizing creates credentials on the new grant version without
reviving old tokens. Global sign-out, password changes and resets also invalidate
previous approvals and tokens, including exchanges already in progress. Manually
configured session bearer tokens use account-wide revocation instead.

Upgrading to 0.5.0 requires OAuth clients to reauthorize: migration
`027_oauth_grants` clears legacy codes and refresh tokens, and old access tokens
lack the required grant version. Registered client metadata is retained.

Access tokens are JWTs whose `aud` is `<FRONTEND_URL>/api/mcp`. The REST API's session
decoder rejects any token with an audience, so a token issued to ChatGPT works only on
the MCP endpoint. Access and refresh tokens both carry the user's `token_version`, so
"Sign out everywhere", a password change, or a reset disconnects every linked client;
deleting the account removes its grants. Authorization codes and refresh tokens are
stored as SHA-256 digests (migration `022_oauth_tables`).

`FRONTEND_URL` must be the public origin clients reach: it is the base of the issuer,
the resource identifier, and the consent-page URL. Caddy routes `/.well-known/oauth-*`
to the backend; everything else lives under `/api`.

The endpoint also accepts the REST API's own bearer JWT, for scripts and local testing.

The only scope is `offline_access`, advertised in the metadata and granted by default.
Refresh tokens are issued either way; ChatGPT looks for the scope before relying on them.

### Rate limits

Per client address, using the same limiter as the rest of the API:

| Endpoint | Default | Setting |
|---|---|---|
| `POST /api/oauth/register` | 20/minute | `OAUTH_REGISTER_RATE_LIMIT` |
| `POST /api/oauth/token`, `POST /api/oauth/revoke` | 60/minute | `OAUTH_TOKEN_RATE_LIMIT` |
| `GET /api/oauth/consent` | 30/minute | — |
| `POST /api/oauth/consent` | 10/minute | — |

ChatGPT calls `/register` and `/token` from OpenAI's servers, whose addresses all of its
users share, so these limits are looser than the browser-facing login limits. Raise them if
many users connect at the same time and some get `429`.

Not implemented: client ID metadata documents (OpenAI's preferred registration method;
ChatGPT also supports dynamic registration), the RFC 9207 `iss` response parameter (so
ChatGPT uses a callback-specific redirect URI), and mTLS verification of ChatGPT's client
certificate.

## Connecting ChatGPT

### 1. Prepare the server

After an explicitly approved deployment of the endpoint, check:

- **Caddy** uses the repository's `Caddyfile`, which routes `/.well-known/oauth-*` to the
  backend. Without it the discovery documents return the frontend's 404 page.
- **`FRONTEND_URL`** is exactly the public HTTPS origin, e.g. `https://yourdomain.com`
  (no trailing slash, no `www.` mismatch). The issuer, the token audience, and the consent
  page are all built from it.
- **`REGISTRATION_MODE=open`** if people who do not have an account yet should be able to
  sign up from the connect flow. With `closed`, only existing users can connect.
- **Back up the database** before the first start: all pending migrations run then, including OAuth tables (022), immutable
  subjects (026), and grant revocation (027).

Confirm discovery works from outside:

```bash
curl -si -X POST https://yourdomain.com/api/mcp | grep -i www-authenticate
curl -s https://yourdomain.com/.well-known/oauth-protected-resource/api/mcp
curl -s https://yourdomain.com/.well-known/oauth-authorization-server/api/oauth
```

The first must show `resource_metadata=...`; the other two must return JSON whose URLs
start with your `FRONTEND_URL`.

### 2. Add it in ChatGPT

Follow OpenAI's [connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)
for the current ChatGPT UI and workspace requirements. Configure a custom remote
MCP server with:

- Server URL: `https://yourdomain.com/api/mcp`.
- Authentication: OAuth, using this server's discovery and dynamic client
  registration; leave manually supplied client credentials empty.
- Account linking: sign in on this site's consent page, verify the account,
  and allow access.

After connecting, confirm all five tools above are available. Refresh the
client's tool catalogue after a server-side tool-schema change.

### 3. Use it

Select the connected integration in a new conversation. For example:

- "Help me write a prompt for a customer-support assistant, then save it as Support reply."
- "Show my saved prompts in the `Marketing` folder."
- "Open my Support reply prompt, make it more concise, and save the new version."

ChatGPT drafts and revises the text itself and calls the tools to store it, so the prompt
appears in the website's library straight away and earlier versions stay in its history.

After changing the tools on the server, refresh the integration's tool catalogue
and start a new conversation.

### 4. Disconnect

Removing the plugin in ChatGPT stops it from calling the server. To cut off every linked
client from the server side, use **Sign out everywhere** in Settings or change the
password: access and refresh tokens are rejected immediately.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Registration fails with `invalid_redirect_uri` | The client's callback host is not in `OAUTH_REDIRECT_HOSTS` (ChatGPT's is `chatgpt.com`). |
| ChatGPT keeps asking to sign in, or every tool call gets `401` | `FRONTEND_URL` differs from the URL ChatGPT uses, so the token's audience does not match; or the account signed out everywhere. |
| Discovery URLs return an HTML page | Caddy is still running the old `Caddyfile`: it reads the file only at start, and `up -d --build` does not restart it. Run `docker compose -f docker-compose.yml up -d --force-recreate caddy` (a `caddy reload` is not enough after `git pull`, because the single-file bind mount still points at the replaced file). |
| Consent page says the request expired | More than 15 minutes passed since ChatGPT started the flow; connect again. |
| "Registration is closed on this instance" | `REGISTRATION_MODE` is `closed`; create the account another way or open registration. |
| `429` from `/api/oauth/register` or `/token` | Many users connecting at once from OpenAI's shared addresses; raise the limits above. |
| A tool is missing or outdated | Refresh the integration's tool catalogue. |


## Testing it locally

```bash
# For local HTTP, configure COOKIE_SECURE=false in the server environment.
# Log in and read the session JWT from the cookie jar
curl -s -c /tmp/jar -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "<user>", "password": "<password>"}' > /dev/null
TOKEN=$(awk '$6 == "access_token" {print $7}' /tmp/jar)

# List the tools
curl -s http://localhost:8000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'
```

Any MCP client that supports Streamable HTTP and custom headers, such as the MCP
Inspector, can connect to `http://localhost:8000/api/mcp` with the same
`Authorization` header. Tokens expire after `ACCESS_TOKEN_EXPIRE_MINUTES`.
