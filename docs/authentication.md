# Authentication System

Prompt Maker Studio uses JWT bearer authentication with bcrypt password hashes. JWTs are
signed with HS256 through PyJWT and expire after the configured number of minutes
(30 by default).

## User Data

The `users` table stores `id`, normalized `username`, `hashed_password`,
`email`, password-reset token fields, and `created_at`. Registration requires
a unique username, password (8-72 characters), and valid email address.

## Authentication Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create an account (201) |
| POST | `/api/auth/login` | No | Return a JWT access token |
| POST | `/api/auth/refresh` | Yes | Renew a still-valid JWT before a long operation |
| GET | `/api/auth/me` | Yes | Return the current profile |
| PATCH | `/api/auth/me` | Yes | Update email and/or username |
| DELETE | `/api/auth/me` | Yes | Delete account and owned prompts |
| POST | `/api/auth/change-password` | Yes | Verify current password and set a new one |
| POST | `/api/auth/forgot-password` | No | Request a password-reset email |
| POST | `/api/auth/reset-password` | No | Complete password reset with a single-use token |

### Registration

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "johndoe",
  "password": "securepassword123",
  "email": "john@example.com"
}
```

The response contains `id`, `username`, `email`, and `created_at`.
Usernames are normalized with `.strip().lower()` during registration and login.

### Sessions

`POST /api/auth/login` does **not** return the token in its body. It sets two
cookies and returns only `{"token_type", "expires_at"}`:

| Cookie | httpOnly | Purpose |
|---|---|---|
| `access_token` | yes | The JWT. Unreadable by page scripts, so an XSS cannot exfiltrate it. |
| `csrf_token` | no | Random per issue. The client reads it and echoes it back. |

The browser attaches `access_token` automatically, so every frontend request
sets `credentials: 'include'`. `POST /api/auth/logout` clears both cookies; it
is unauthenticated, so signing out works even after the token has expired.

### Re-authentication for destructive actions

`DELETE /api/auth/me` requires `current_password` in the body. It removes the
account and every row that references it, irreversibly, so an unattended or
stolen browser session must not be sufficient on its own — the Settings flow
used to need only two clicks. A wrong password returns 401 and changes nothing;
on success the session cookies are cleared so the browser is not left holding a
session for an account that no longer exists.

### Session revocation

Every token carries a `tv` claim holding the `users.token_version` it was minted
against, and authentication rejects a token whose `tv` no longer matches the
stored value. That is what makes a token revocable at all — clearing cookies
only affects the browser doing the clearing, so a session copied elsewhere would
otherwise stay valid for the rest of its lifetime.

`token_version` is incremented on:

| Event | Effect |
|---|---|
| `POST /api/auth/change-password` | All other sessions die; the caller is re-issued a token on the new version, so the tab making the change stays signed in. |
| `POST /api/auth/reset-password` | All sessions die, including the caller's. Recovering an account has to evict whoever prompted the recovery. |
| `POST /api/auth/logout-all` | All sessions die, including the caller's. Surfaced in Settings as "Sign out everywhere". |

Tokens minted before this claim existed carry no `tv` and are read as version 0,
which matches the column default — so an upgrade does not sign everyone out.

### CSRF

Because the session cookie travels automatically, cookie-authenticated
state-changing requests must also carry the CSRF token in an `X-CSRF-Token`
header, compared against the `csrf_token` cookie (double-submit). An attacker
on another origin can cause the cookie to be sent but cannot read it to forge
the header.

- Safe methods (GET/HEAD/OPTIONS/TRACE) are exempt.
- **Bearer-authenticated requests are exempt**, since a browser never attaches
  `Authorization` on its own. `Authorization: Bearer <jwt>` still works for
  scripts and CI, and is what the backend test suite uses.
- A missing or mismatched token returns 403.

Invalid, expired, or userless tokens return 401. Requests with neither a
session cookie nor a bearer credential are rejected the same way.

The frontend renews a still-valid session before long-running evaluation and
delayed-delete requests, and retries an eval-history request once after a 401 —
rebuilding headers per attempt, because a refresh rotates the CSRF token. An
expired session cannot be refreshed and still requires login.

## Prompt Access

All mutating prompt operations and prompt data retrieval require authentication:

- `POST /api/prompts/parse-text`
- `POST /api/prompts/generate`
- `GET /api/prompts/saved`
- `GET /api/prompts/history`
- `GET`, `PATCH`, `DELETE /api/prompts/{id}`
- `POST /api/prompts/{id}/duplicate`

`GET /api/prompts/config` **requires authentication**. It used to be the one
unauthenticated route in `routes.py`, back when AI availability was a global
env check; with bring-your-own provider credentials, "is AI available" is a
question about the calling user's own connection. It returns
`provider_connected` (so AI import and the Playground can point at Settings
instead of failing at call time), `provider` / `provider_label` / `model`
describing that connection, `available_models` (empty when unconnected, so the
UI never advertises a model it cannot run), and the operator's global budget
snapshot — `budget_exhausted` plus `global_budget_remaining_usd`, which is
`null` when no `GLOBAL_MONTHLY_BUDGET_USD` ceiling is configured. It never
returns the stored API key.

The connection itself is managed through `/api/auth/me/llm-connection`
(GET/PUT/DELETE, plus `POST .../test` for a probe). Keys are stored Fernet-
encrypted; responses carry only a masked `api_key_hint`.

Owned prompt lookups return 404 both for missing records and records owned by
another user, preventing resource-existence disclosure.

## Configuration

```env
SECRET_KEY=<strong-random-secret>
ACCESS_TOKEN_EXPIRE_MINUTES=30
FRONTEND_URL=https://yourdomain.com

# Optional cookie-domain override. Leave unset in the documented deployment:
# the app and /api share one origin, and a host-only cookie is both sufficient
# and more narrowly scoped. Configure this only for a deliberate custom
# topology that requires a cookie to span trusted sibling subdomains.
COOKIE_DOMAIN=

# Marks cookies HTTPS-only. Defaults to true; set false ONLY when serving over
# plain HTTP locally, where a Secure cookie would never be sent back.
COOKIE_SECURE=true

# Optional. Encrypts each user's stored LLM provider API key. Defaults to key
# material derived from SECRET_KEY — set it explicitly if you want to rotate
# JWT signing without making stored provider credentials undecryptable.
LLM_ENCRYPTION_KEY=

# Required for password-reset email delivery
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=Prompt Maker Studio <no-reply@yourdomain.com>
```

Use HTTPS in production. The frontend holds no token at all — only
`prompt-maker-studio:client-session-expiry`, a timestamp it uses to warn about
an imminent timeout. It calls the backend at relative `/api/...` URLs on its own origin, which the
deployment routes to the backend (Caddy in production, the Next server's
`API_PROXY_TARGET` rewrite otherwise). Same-origin requests carry the session
cookie without any cross-site cookie or CORS configuration.

`CORS_ORIGINS` therefore does not apply to normal browser traffic. It matters
only when a frontend on a different origin talks to this backend — and there,
because cookies are involved, it must list exact origins: credentialed CORS
requests cannot use a `*` wildcard.

## Testing

From the repository root:

```bash
make test-file FILE=tests/test_auth.py
```

For direct pytest, activate `.venv`, change into `backend/`, and run
`pytest tests/test_auth.py -v`.
