# Security Policy

## Supported versions

Prompt Maker Studio is early-stage software. Security fixes are developed on
`main` and published in a new release tag. There are no long-term support
branches and fixes are not backported to older release lines.

| Version | Supported |
|---|---|
| `main` | Yes |
| Latest tagged release | Yes |
| Older tagged releases | No |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately through either channel:

1. **GitHub Private Vulnerability Reporting** (preferred) — go to the
   [Security tab](https://github.com/chrysogonus/prompt-maker-studio/security/advisories/new)
   and choose "Report a vulnerability". This keeps the report private
   until a fix is published.

2. **Email** — `promptmakerstudio@proton.me`

   Use this if you cannot access GitHub's advisory form. Encrypt the report
   if it contains sensitive proof-of-concept data.

### What to include

- The affected component (backend route, frontend page, Compose service, script)
- Version, commit SHA, or tag you tested against
- Reproduction steps or a proof-of-concept request
- What an attacker gains — data disclosure, privilege escalation, denial of service
- Any suggested remediation

### What to expect

| Stage | Target |
|---|---|
| Acknowledgement of report | Within 5 business days |
| Initial assessment and severity triage | Within 10 business days |
| Fix or documented mitigation for confirmed high-severity issues | Within 90 days |

These are good-faith targets for a project maintained by a single author,
not a contractual SLA.

We will credit reporters in the release notes unless you ask to remain
anonymous. There is no bug-bounty program and no monetary reward.

## Coordinated disclosure

Please give us a reasonable window to ship a fix before publishing
details. We aim to release a patch and advisory within 90 days of a
confirmed report and will keep you updated on progress.

## Scope

In scope:

- Authentication and session handling (JWT issuance, renewal, password reset)
- Authorization gaps allowing access to another user's prompts or run history
- Injection, SSRF, or deserialization flaws in the FastAPI backend
- Secret leakage through API responses, logs, or frontend bundles
- Rate-limit bypass on registration and admin diagnostics endpoints
- Insecure defaults in the shipped Docker Compose and Caddy configuration

Out of scope:

- Vulnerabilities in an external LLM provider or model service itself
- Findings that require a compromised host, a stolen `.env`, or physical access
- Missing hardening headers with no demonstrated impact
- Automated scanner output submitted without a working proof of concept
- Denial of service through unrealistic request volume against a local instance
- Social engineering of the maintainer

## Operator security notes

Anyone self-hosting Prompt Maker Studio is responsible for their own deployment:

- Generate a unique `SECRET_KEY` (`openssl rand -hex 32`). Never reuse the
  example value — it is public and would let anyone forge JWTs.
- Prometheus and Grafana are opt-in (`--profile monitoring`) and left out of
  the default stack: they are third-party images whose bundled dependencies
  carry known HIGH/CRITICAL advisories with no fix this project can apply.
  If you enable them, set a strong `GRAFANA_ADMIN_PASSWORD`; the stack is not
  exposed publicly by default and should stay that way.
- LLM access normally uses each user's own provider credential from
  Settings → AI connection. An operator may configure a shared server default
  with `LLM_BASE_URL` and `LLM_MODEL`, plus `LLM_PROVIDER` and `LLM_API_KEY`
  when needed. A usable user connection takes precedence. The owner of the
  selected credential pays the provider; a shared default can therefore incur
  operator charges. `GLOBAL_MONTHLY_BUDGET_USD` and `USER_MONTHLY_BUDGET_USD`
  cap estimated monthly activity, with no reservation across concurrent calls;
  they are bounded usage controls rather than exact spending guarantees.
- Per-user provider API keys are stored **encrypted at rest** (Fernet, via
  `backend/app/services/secret_store.py`). Key material comes from
  `LLM_ENCRYPTION_KEY` when set, otherwise it is derived from `SECRET_KEY`.
  Rotating whichever key is in use makes existing stored credentials
  undecryptable — users are prompted to re-enter theirs. Set
  `LLM_ENCRYPTION_KEY` explicitly if you want to rotate JWT signing
  independently of stored credentials. Database backups now contain
  encrypted third-party credentials: protect them accordingly.
- **Server-side request forgery.** A user-supplied provider base URL becomes a
  server-side request target. It is validated at the boundary — `http`/`https`
  only, a parseable host, no embedded username/password, no query string or
  fragment — and the host is resolved and rejected if **any** answer is a
  private, loopback, link-local, multicast, reserved, or unspecified address.
  Checking every answer matters: a name resolving to one public and one
  internal address would otherwise pass and then connect internally.

  `ALLOW_PRIVATE_LLM_URLS=true` turns the block off, which is what a
  self-hosted Ollama or vLLM server on the local network needs. Enable it only
  where you control every account: with it on, any user can make the backend
  reach Docker-internal services, localhost listeners, RFC1918 hosts, and cloud
  metadata endpoints. Response bodies are parsed as chat completions (so a
  non-JSON service yields an error rather than content), but timing and error
  shape are observable, and a service that returns JSON could echo content back
  through a Try once run.

  With the default private-address block enabled, outbound user connections
  resolve and validate every address again in `PublicLLMTransport`, then connect
  to those exact IPs while retaining the original Host header and TLS hostname.
  Redirects and environment proxies are disabled on these clients, closing the
  save-time DNS-rebinding and redirect gaps. `ALLOW_PRIVATE_LLM_URLS=true`
  disables this transport policy. Operator-configured server defaults are
  trusted and also bypass it, allowing a private local provider without granting
  private-network access to user-supplied URLs. Network-level egress controls
  remain useful defence in depth.
- **Registration is open by default.** Anyone who can reach the instance can
  create an account. An account unlocks the provider-URL surface above, which
  is why user-supplied private URLs stay blocked unless `ALLOW_PRIVATE_LLM_URLS`
  is set. For a private install set `REGISTRATION_MODE=closed`: it admits only
  the first account, so a fresh install is usable and then locks. Any other
  value also means closed, so a typo never opens sign-up.
- **The free refiner is off by default.** `PUBLIC_REFINE_ENABLED=true` lets
  signed-out visitors send up to 8,000 characters to the operator's server
  default for refinement. It is bounded per visitor IP (`PUBLIC_REFINE_RATE_LIMIT`,
  in memory), per day across all visitors (`PUBLIC_REFINE_DAILY_LIMIT`) and per
  month (`PUBLIC_MONTHLY_BUDGET_USD`, also counted toward
  `GLOBAL_MONTHLY_BUDGET_USD`), with answers capped at
  `PUBLIC_REFINE_MAX_OUTPUT_TOKENS` and a honeypot field against simple bots. Its
  spend is recorded without user, IP address or prompt text. Per-IP limits rely
  on the backend seeing real client addresses behind the proxy.
- **Content-Security-Policy.** `'unsafe-eval'` has been removed; scripts, frames,
  connections, form targets, and the document base are all locked to the origin,
  and `object-src` is `'none'`. `script-src` still allows `'unsafe-inline'`,
  which is the policy's remaining weak point: Next's App Router streams flight
  data as inline `<script>` blocks whose contents vary per page and per build, so
  neither `script-src 'self'` alone nor a single fixed hash covers them.
  Adopting per-response nonces would require changes to rendering and header
  delivery beyond the current static Caddy policy. An injected script could
  therefore still act through the victim's session, so treat XSS prevention in the app code as the primary control.
- **Outbound traffic.** Beyond your own LLM provider and SMTP server, the
  backend makes one kind of request: published model prices, from a pinned
  revision of LiteLLM's model index on `raw.githubusercontent.com`, cached for
  24 hours. It sends no identifying information. Set
  `LLM_PRICING_REFRESH=false` to disable it, or `LLM_PRICING_URL` to point at a
  mirror. Next.js telemetry is disabled in the images and in CI.
- Eval rule regexes (`~pattern` criteria) are matched in a killable worker
  process under a hard time limit, so a catastrophically backtracking pattern
  costs a fraction of a second instead of pegging a core. A rule that cannot be
  evaluated in the budget is reported as unevaluatable rather than scored as a
  failed check.
- Transactional mail always runs over verified TLS: the certificate chain and
  hostname are checked and a verification failure aborts the send rather than
  falling back. Choose `SMTP_TLS_MODE=implicit` for a TLS-on-connect port (465)
  instead of relying on the port number to imply it.
- Leave `ADMIN_DIAGNOSTICS_TOKEN` unset unless you need the operator SMTP
  check; the endpoint returns 503 when it is unset.
- Never commit `.env`. It is listed in `.gitignore` — keep it that way.
