# Security Review Checklist

Based on OWASP Top 10 and general secure coding principles.

## A01 — Broken Access Control

- [ ] Every endpoint/operation checks that the authenticated user is authorized for the specific resource (not just logged in).
- [ ] Authorization logic is server-side — client-supplied role/permission claims are not trusted without verification.
- [ ] Direct object references (IDs in URLs/params) are validated against the current user's permissions.
- [ ] Admin or privileged routes are separated and explicitly protected.
- [ ] File system access uses path canonicalization to prevent path traversal (`../../../etc/passwd`).

## A02 — Cryptographic Failures

- [ ] Sensitive data (passwords, tokens, PII, payment info) is not stored or logged in plaintext.
- [ ] Passwords are hashed with a modern adaptive algorithm: `bcrypt`, `argon2`, or `scrypt` — never `md5`, `sha1`, or unsalted `sha256`.
- [ ] Secrets and API keys are read from environment variables or a secret manager — never hardcoded in source.
- [ ] `.env` files are in `.gitignore`; no credentials appear in git history.
- [ ] TLS is enforced for all external connections — no `verify=False` or certificate validation disabled.
- [ ] Cryptographic operations use established libraries — no hand-rolled crypto.

## A03 — Injection

- [ ] **SQL**: Parameterized queries or an ORM are used. No string concatenation or f-string formatting of SQL with user input.
- [ ] **Shell**: `subprocess` / `child_process` calls use argument arrays, not shell strings. `shell=True` (Python) or `shell: true` (Node) with user input is a critical vulnerability.
- [ ] **LDAP / XPath / NoSQL**: User input is sanitized before being used in queries.
- [ ] **Template injection**: User input is never passed to template engines as template code — only as data/context.
- [ ] **Log injection**: User input written to logs is sanitized to prevent log forging (strip newlines).

## A04 — Insecure Design

- [ ] Rate limiting is applied to authentication, registration, password reset, and expensive operations.
- [ ] Sensitive operations (account deletion, password change) require re-authentication.
- [ ] Business logic edge cases are considered: negative quantities, skipped steps, replay attacks.

## A05 — Security Misconfiguration

- [ ] Debug mode, verbose error output, and stack traces are disabled in production.
- [ ] Default credentials are changed; no test/demo accounts in production configs.
- [ ] Unnecessary features, endpoints, and services are disabled.
- [ ] HTTP security headers are set: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`.
- [ ] CORS is configured explicitly — not `Access-Control-Allow-Origin: *` for authenticated APIs.

## A06 — Vulnerable and Outdated Components

- [ ] Dependencies are pinned to specific versions.
- [ ] No dependencies with known critical CVEs (check `pip audit`, `npm audit`, `trivy`, Snyk, etc.).
- [ ] Docker base images are recent and not end-of-life.

## A07 — Identification and Authentication Failures

- [ ] Passwords have a minimum length requirement (≥12 characters recommended).
- [ ] Authentication failures return a generic message — no enumeration of valid usernames/emails.
- [ ] Brute-force protection: account lockout or exponential backoff.
- [ ] Session tokens and JWTs are cryptographically strong and expire appropriately.
- [ ] JWT signatures are verified with the correct algorithm — `alg: none` attacks are prevented.
- [ ] Tokens are invalidated on logout.

## A08 — Software and Data Integrity Failures

- [ ] Deserialization of untrusted data uses safe formats (JSON) — `pickle`, `yaml.load()` (use `yaml.safe_load()`), and Java serialization are dangerous with untrusted input.
- [ ] CI/CD pipelines verify the integrity of dependencies (lockfiles committed, checksums verified).
- [ ] Auto-update mechanisms verify signatures before applying updates.

## A09 — Security Logging and Monitoring Failures

- [ ] Authentication events (success and failure), authorization failures, and high-value actions are logged.
- [ ] Logs include enough context (timestamp, user/session ID, IP, action) to reconstruct an incident.
- [ ] Logs do NOT contain passwords, tokens, PII, or secrets.
- [ ] Log entries from user input are sanitized to prevent log injection.

## A10 — Server-Side Request Forgery (SSRF)

- [ ] User-supplied URLs are validated against an allowlist of permitted schemes and hosts.
- [ ] Internal network addresses (`169.254.x.x`, `10.x.x.x`, `192.168.x.x`, `127.x.x.x`, `::1`) are blocked from user-supplied URLs.
- [ ] HTTP clients do not follow redirects to internal hosts.

## Additional Checks

- [ ] File uploads: type is validated server-side (not just by extension), size is limited, files are stored outside the web root, and filenames are sanitized.
- [ ] Sensitive environment variables are not printed, logged, or exposed through error messages.
- [ ] Regex patterns on untrusted input are checked for catastrophic backtracking (ReDoS).
- [ ] `eval()` and equivalent dynamic code execution with user input is absent.
