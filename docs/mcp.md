# MCP Endpoint (ChatGPT Integration)

`POST /api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes a user's saved-prompt library as tools. It is the backend for the planned
ChatGPT integration: ChatGPT writes and refines the prompt text in conversation, and
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

The endpoint accepts the same bearer JWT as the REST API, including the
`token_version` revocation check, so "Sign out everywhere" and password changes
disconnect MCP clients too. Unauthenticated requests get `401` with a
`WWW-Authenticate: Bearer` header.

OAuth account linking, which ChatGPT needs to obtain a token for an end user, is
**not implemented yet**. Until then the endpoint can be tested with a token taken
from a normal login.

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
