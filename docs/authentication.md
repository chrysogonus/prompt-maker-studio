# Authentication System

Prompt Maker Studio uses JWT sessions in httpOnly cookies (with optional bearer authentication) and
bcrypt password hashes. JWTs are
signed with HS256 through PyJWT and expire after the configured number of minutes
(30 by default).

## User Data

The `users` table stores `id`, immutable UUID `auth_subject`, normalized `username`, `hashed_password`,
`email`, password-reset token fields, and `created_at`. Registration requires
a unique username, password, and valid email address. Registration, password
changes, and resets apply the same policy: at least 10 characters, at least one
number, at least one special character (anything other than a letter, digit, or
whitespace), and at most 72 UTF-8 bytes; multibyte characters count toward
bcrypt's 72-byte limit. Login does not apply the policy, so older passwords keep
working until they are changed.
Overlength passwords submitted for verification are rejected safely.

## Authentication Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create an account (201); `REGISTER_RATE_LIMIT`, default 5/min |
| POST | `/api/auth/login` | No | Set session/CSRF cookies and return expiry metadata; `LOGIN_RATE_LIMIT`, default 10/min |
| POST | `/api/auth/refresh` | Yes | Renew a still-valid JWT while the user is active |
| POST | `/api/auth/logout` | No | Clear the current browser session cookies |
| POST | `/api/auth/logout-all` | Yes | Revoke all account sessions and linked OAuth credentials |
| GET | `/api/auth/me` | Yes | Return the current profile |
| PATCH | `/api/auth/me` | Yes | Update `new_username`, library/eval preferences, or email (changed email requires `current_password`) |
| DELETE | `/api/auth/me` | Yes | Delete account and owned prompts |
| POST | `/api/auth/change-password` | Yes | Verify current password and set a new one |
| POST | `/api/auth/forgot-password` | No | Request a password-reset email |
| POST | `/api/auth/reset-password` | No | Complete password reset with a single-use token |
| GET, PUT, DELETE | `/api/auth/me/llm-connection` | Yes | Read, set or remove the caller's AI provider connection (see [Prompt Access](#prompt-access) below and the [API reference](api.md)) |
| GET | `/api/auth/me/llm-connection/models` | Yes | Models for the chosen provider, with estimated prices |
| POST | `/api/auth/me/llm-connection/test` | Yes | Probe the saved connection, or unsaved form values |
| GET | `/api/auth/me/connected-apps` | Yes | MCP clients, such as ChatGPT or Claude, still linked to the account |
| DELETE | `/api/auth/me/connected-apps/{client_id}` | Yes | Disconnect one linked client |

### Registration

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "johndoe",
  "password": "secure-password123",
  "email": "john@example.com"
}
```

The response contains `id`, `username`, `email`, `created_at`, and library/evaluation
preferences. `REGISTRATION_MODE` defaults to `open`. With `closed` (or any unrecognised
value), the first account can still register, then registration returns 403.
Usernames are normalized with `.strip().lower()` during registration and login.
Duplicate usernames and emails receive the same generic 400 response.
The login `username` field accepts either the username or the account email:
an identifier containing `@` is matched against the email, since usernames
cannot contain one. Failed logins check a dummy bcrypt hash for unknown
accounts to reduce timing differences from existing accounts.

### Sessions

`POST /api/auth/login` does **not** return the token in its body. It sets two
cookies and returns only `{"token_type", "expires_at"}`:

| Cookie | httpOnly | Purpose |
|---|---|---|
| `access_token` | yes | The JWT; inaccessible through `document.cookie`. |
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

Changing the email through `PATCH /api/auth/me` also requires `current_password`,
because the email is what password recovery trusts: a stolen session must not be
able to redirect it. Resubmitting the unchanged address needs no password. After
a change, the previous address receives a notice naming the new one in redacted
form; a delivery failure is logged and does not undo the change. Renaming does
not end the session, because tokens identify the account by `auth_subject`.

### Token identity

Session and MCP access tokens use `users.auth_subject` as their `sub` claim.
The UUID stays with the account through username changes and is regenerated for
new accounts, including when SQLite reuses a deleted user's numeric ID. A token
cannot become another account's credential when that account claims an old name.
Migration 026 assigns subjects to existing accounts. Previously issued tokens
whose subject is a username are rejected, so users must sign in again and MCP
clients must renew their access token or reconnect.

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
which matches the column default. This version compatibility does not accept
legacy username subjects; migration 026 requires those sessions to authenticate again.

### Password recovery

Forgot-password always returns the same 200 response, including for unknown
addresses and email-delivery failures. A reset link expires after one hour;
only its SHA-256 digest is persisted. Successful reset consumes the token,
replaces the password and increments the account revocation version. Expired
tokens are cleared; invalid or expired links return 400.

### CSRF

Because the session cookie travels automatically, cookie-authenticated
state-changing requests must also carry the CSRF token in an `X-CSRF-Token`
header, compared against the `csrf_token` cookie (double-submit). An attacker
on another origin can cause the cookie to be sent but cannot read it to forge
the header.

- Safe methods (GET/HEAD/OPTIONS/TRACE) are exempt.
- **Bearer-authenticated requests are exempt**, since a browser never attaches
  `Authorization` on its own. `Authorization: Bearer <jwt>` works for
  scripts and CI that do not send a session cookie, and is used by backend tests.
- A missing or mismatched token returns 403.

Invalid, expired, or userless tokens return 401. Requests with neither a
session cookie nor a bearer credential are rejected the same way. The session
cookie takes precedence when both are sent, so including a bearer header does
not bypass CSRF while that cookie is present.

While the user is active (keyboard or pointer input), the frontend renews the
session every five minutes, or halfway through a shorter session lifetime, so
working users stay signed in and an idle tab still expires after
`ACCESS_TOKEN_EXPIRE_MINUTES`. Sign-out waits for pending refreshes before
clearing cookies, and a new login waits for that cleanup. It also renews a
still-valid session before a delayed prompt deletion, and retries an
authenticated request once after a 401, rebuilding headers per attempt. A
refresh keeps the CSRF token it was sent, so writes already in flight still
match; login, password change and sign-out issue a new one. An expired session
cannot be refreshed and still requires login.

Each token carries an `auth_time` claim: when the user last entered their
password (login or password change). Refreshes carry it forward and never
extend a session more than 12 hours (`MAX_SESSION_AGE`) past it; after that
`/api/auth/refresh` returns 401 and the user signs in again. Tokens issued before
the claim existed fall back to their `iat`.

## Prompt Access

All prompt operations, including Try once, refinement and retained evaluation
endpoints, require authentication. Core library routes include:

- `POST /api/prompts` and `POST /api/prompts/parse-text`
- `GET /api/prompts/saved` and `GET`, `PATCH`, `DELETE /api/prompts/folders`
- `GET`, `PATCH`, `DELETE /api/prompts/{id}`
- `POST /api/prompts/{id}/duplicate`, versions and restore

`GET /api/prompts/config` **requires authentication**. It used to be the one
unauthenticated route in `routes.py`, back when AI availability was a global
env check; with bring-your-own provider credentials, "is AI available" is a
question about the calling user's effective connection: a usable own connection
first, otherwise the optional operator server default. It returns
`provider_connected` (so AI features can point at Settings instead of failing
at call time when neither connection exists), `provider` / `provider_label` / `model`
describing that effective connection, `available_models` (suggestions, empty
when neither connection exists; discovery is not proof of feature compatibility), and the operator's global budget
snapshot — `budget_exhausted` plus `global_budget_remaining_usd`, which is
`null` when no `GLOBAL_MONTHLY_BUDGET_USD` ceiling is configured. It never
returns the stored API key.

The connection itself is managed through `/api/auth/me/llm-connection`
(GET/PUT/DELETE, plus `POST .../test` for a probe and `GET .../models` for the
provider's model/pricing catalogue). Keys are stored Fernet-encrypted; responses
carry only a masked `api_key_hint`. `configured` describes the user's own
connection; `server_default` exposes only the operator connection's provider
label and model. Disconnecting removes the own connection and key, so AI
features fall back to the server default if one exists. Updating the same
provider without `api_key` retains the key; switching provider cannot reuse it.

User-supplied provider URLs are checked against the public-egress policy;
`ALLOW_PRIVATE_LLM_URLS=true` permits private/self-hosted endpoints. The connection
response's `private_urls_allowed` reports that setting, so Settings suggests a local
Ollama or vLLM address only where one can work. The
operator-configured `LLM_*` server default is trusted and may use a private URL.

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
make test-file FILE=tests/test_auth_cookies.py
make test-file FILE=tests/test_auth_identity.py
```

For direct pytest, activate `.venv`, change into `backend/`, and run
`pytest tests/test_auth.py -v`.
