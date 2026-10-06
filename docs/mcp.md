# MCP Endpoint (ChatGPT Integration)

`POST /api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes a user's saved-prompt library as tools. It is the backend for the ChatGPT
integration: ChatGPT writes and refines the prompt text in conversation, and
these tools store and retrieve it. Nothing on this endpoint calls an LLM, so users need
no provider connection to use it.

It is mounted inside the existing FastAPI app (`backend/app/api/mcp_routes.py`) and
runs in stateless, JSON-response mode, so each request is independent.

## Tools

| Tool | Read-only | Wraps |
|---|---|---|
| `list_saved_prompts` | Yes | `GET /api/prompts/saved` (summaries only, no prompt text) |
| `get_prompt` | Yes | `GET /api/prompts/{id}` |
| `save_prompt` | No | `POST /api/prompts/generate`, always with a name |
| `update_prompt` | No | `PATCH /api/prompts/{id}` |
| `list_prompt_versions` | Yes | `GET /api/prompts/{id}/versions` |

The tools call the same route handlers as the REST API, so ownership checks (404 for
another user's prompt), version snapshots, and edit-conflict detection are shared.
Two behaviours differ deliberately:

- `update_prompt` re-renders `generated_prompt` from the new fields, and requires
  `last_updated_at`. The REST `PATCH` leaves both to the client.
- `save_prompt` is not subject to `/generate`'s per-IP rate limit, because all
  ChatGPT traffic arrives from OpenAI's addresses and would share one bucket.

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

Not implemented: client ID metadata documents (OpenAI's preferred registration method;
ChatGPT also supports dynamic registration), the RFC 9207 `iss` response parameter (so
ChatGPT uses a callback-specific redirect URI), mTLS verification of ChatGPT's client
certificate, and rate limits on registration and token requests.

## Testing it locally

```bash
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
