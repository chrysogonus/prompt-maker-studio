# VM Deployment Guide

This guide explains how to deploy the Prompt Maker Studio application on a Virtual Machine (VM).

## Architecture

The application uses Docker Compose with the following services:
- **Backend**: FastAPI application — internal only (port 8000 on the Docker network)
- **Frontend**: Next.js application — internal only (port 3000 on the Docker network)
- **Caddy**: Reverse proxy exposing public ports 80 and 443, handles TLS automatically via Let's Encrypt

Services communicate over the `prompt-maker-studio-network` Docker bridge network. External traffic enters through Caddy.
- **Prometheus / Grafana**: optional, behind the `monitoring` Compose profile;
  bind loopback-only operator ports 9090 and 3010 when enabled.
  See [monitoring](./monitoring.md) for dashboards, alert configuration and SSH tunnels.

> **Scaling constraint**: Run exactly one backend replica. The backend applies
> SQLite migrations automatically during startup; that design is not safe for
> rolling or concurrent multi-replica startup. Introduce an external migration
> job and a multi-writer database before scaling the backend horizontally.

> **Local development**: `docker compose up` automatically applies `docker-compose.override.yml`, which adds loopback host port mappings (3000 and 8000) and excludes Caddy unless its `caddy` profile is enabled. Do not use the override file in production.

## Prerequisites

- Docker and Docker Compose installed on the VM
- Git (to clone the repository)
- A domain name resolving to the VM for the documented public Caddy/auto-TLS setup

## Environment Configuration

### 1. Create .env File

Copy the example environment file and configure it:

```bash
make setup
```

`make setup` copies `.env.example` and generates a real `SECRET_KEY`. If you
copy the template by hand instead, generate one yourself with
`openssl rand -hex 32` — the backend refuses to start on the published
placeholder, so an unedited copy will fail on first boot.

### 2. Configure Environment Variables

Edit `.env` with your VM-specific settings:

```bash
# Backend Configuration
# Compose hardcodes this persistent path; DATABASE_URL overrides apply only
# to non-Docker backend processes.
# DATABASE_URL=sqlite:////app/data/prompts.db
# Cross-origin frontend/backend topologies only; Caddy's /api path is same-origin.
# CORS_ORIGINS=https://separate-frontend.example.com

# Authentication Configuration
# 64 hex characters from `openssl rand -hex 32` — never the example value
SECRET_KEY=<generated-signing-key>
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Session cookies. Leave COOKIE_DOMAIN unset: the app and API share one origin,
# so a host-only cookie already covers both. Note that `.env.example` ships
# COOKIE_SECURE=false for plain-HTTP local development — it must be true here.
COOKIE_DOMAIN=
COOKIE_SECURE=true

# Default registration admits only the first account, then closes.
REGISTRATION_MODE=closed
# Keep user-supplied private provider URLs disabled unless every account is trusted.
ALLOW_PRIVATE_LLM_URLS=false

# Users configure their own provider under Settings → AI connection.
# Optional shared default for users without a usable own connection:
LLM_PROVIDER=
LLM_BASE_URL=
LLM_MODEL=
LLM_API_KEY=
# This operator-trusted URL may be private without ALLOW_PRIVATE_LLM_URLS.
# Pin the credential-encryption key so rotating SECRET_KEY does not
# invalidate stored user provider keys:
# LLM_ENCRYPTION_KEY=<Fernet key>

# Optional monthly usage ceilings (USD); unset means unlimited.
# See docs/docker.md's Environment Variables section.
# GLOBAL_MONTHLY_BUDGET_USD=50
# USER_MONTHLY_BUDGET_USD=5

# Frontend Configuration
# No API URL to set — browsers call /api on YOUR_DOMAIN and Caddy routes it to
# the backend. FRONTEND_URL also supplies reset links, MCP/OAuth discovery,
# the landing-page canonical URL, robots.txt and sitemap.
FRONTEND_URL=https://YOUR_DOMAIN

# SMTP (required for password-reset emails)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=Prompt Maker Studio <no-reply@yourdomain.com>
SMTP_TLS_MODE=starttls  # use implicit for TLS-on-connect, e.g. port 465

# Caddy Reverse Proxy
# One domain serves both the app and the API (/api); Caddy obtains TLS for it
DOMAIN=yourdomain.com

# Monitoring Configuration
# Compose requires a nonempty value when parsing, even without monitoring.
# Replace the placeholder before enabling Grafana; its entrypoint rejects it.
# Generate with: openssl rand -hex 16
GRAFANA_ADMIN_PASSWORD=change-this-to-a-secure-password
```

### Important Settings for VM Deployment:

1. **CORS_ORIGINS**: Leave this at its default for the documented Caddy
   topology, where `/api` is same-origin. Set exact origins only when a frontend
   on another origin calls the backend directly.

2. **SECRET_KEY**: Generate a secure key:
   ```bash
   openssl rand -hex 32
   ```

3. **No API URL setting**: The frontend calls `/api` on whatever origin served it, so nothing domain-specific is compiled into the bundle and the published image works unchanged on any domain. Caddy routes `/api` to the backend.

4. **DOMAIN**: Used by `Caddyfile` to configure the reverse proxy and obtain a TLS certificate automatically via Let's Encrypt. Caddy serves `/api` from the backend container and everything else from the frontend container, both on this one domain.

5. **COOKIE_DOMAIN / COOKIE_SECURE**: The session token is delivered in an httpOnly cookie. Leave `COOKIE_DOMAIN` unset — the app and the API are the same origin, so a host-only cookie covers both, and widening it only exposes the cookie to other subdomains. `COOKIE_SECURE` must be `true` over HTTPS; `.env.example` ships `false` for local plain-HTTP development, so check it after copying.

6. **GRAFANA_ADMIN_PASSWORD**: Compose requires a nonempty value even when the profile is inactive. Replace the template placeholder with a unique password before enabling the opt-in monitoring stack (`docker compose -f docker-compose.yml --profile monitoring up -d`). Prometheus and Grafana are large third-party images carrying upstream advisories this project cannot fix, so the default stack — `backend`, `frontend`, `caddy` — leaves them out. Enable them deliberately; both bind to loopback only.

## Deployment Steps

### Option 1: Standard Deployment (with Caddy + Auto-TLS)

The repo ships a `Caddyfile` and a `caddy` service in `docker-compose.yml`. Caddy automatically obtains and renews TLS certificates from Let's Encrypt. Point the public domain's DNS record at your VM.

1. **Create a DNS record** pointing your domain to the VM's public IP. One
   record is enough — the API is served from `/api` on the same domain:
   ```
   A  yourdomain.com  → <VM_PUBLIC_IP>
   ```

2. **Clone the repository:**
   ```bash
   sudo install -d -o "$(id -un)" -g "$(id -gn)" /opt/prompt-maker-studio
   git clone <repository-url> /opt/prompt-maker-studio
   cd /opt/prompt-maker-studio
   ```

3. **Configure environment:**
   ```bash
   make setup
   # Edit .env with your settings (see section above)
   nano .env
   ```

4. **Build and start services (production — without override file):**
   ```bash
   docker compose -f docker-compose.yml up -d --build
   ```

5. **Verify deployment:**
   ```bash
   docker compose -f docker-compose.yml ps
   docker compose -f docker-compose.yml logs -f
   ```

Caddy will automatically obtain TLS certificates on first startup. The application will be available at `https://yourdomain.com`.

### Option 2: Production Deployment via GHCR (pre-built images)

Pushing a `v*` version tag builds and publishes images to GitHub Container Registry, after every quality gate passes. You can deploy these instead of building on the server, which is faster and keeps the server free of build tooling.

Publishing is deliberately tied to a version tag rather than to every merge into `main`, and there is no floating `latest` tag: it made an unready — or, if the release job were ever compromised, a poisoned — artifact the default pull.

Images carry build provenance and an SBOM, so you can verify a tag was produced by this repository's workflow:

```bash
docker buildx imagetools inspect ghcr.io/OWNER/prompt-maker-studio-backend:1.2.3 --format '{{ json .Provenance }}'
```

**Prerequisites:**
- Set `GHCR_OWNER` in your `.env` file (your GitHub username or organisation, e.g. `chrysogonus`)
- Set `IMAGE_TAG` in `.env` to a published version (`1.2.3`) or `sha-<short>` tag. The publish job's summary prints the immutable `@sha256:` digest for each image; record it to identify the exact artifact. The supplied override accepts tags in `IMAGE_TAG`, not digest references. To pin digests, supply a further Compose override with each service's full `image: ghcr.io/...@sha256:...` reference.
- If the packages are private, authenticate once:
  ```bash
  printf '%s' "$GITHUB_PAT" | docker login ghcr.io -u <github-username> --password-stdin
  ```
  If the packages are public (GitHub → Packages → Change visibility), no login is needed.

**Deploy a specific release** using its version tag (or a `sha-<short>` tag from the publish job):
```bash
IMAGE_TAG=1.2.3 docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
IMAGE_TAG=1.2.3 docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build
```

### Option 3: Local / Development Deployment

```bash
# Uses docker-compose.yml + docker-compose.override.yml automatically
docker compose up -d --build
```

This binds ports 3000 and 8000 to loopback. Caddy stays excluded unless its
`caddy` profile is explicitly enabled.

## Accessing the Application

After production deployment:

- **Frontend**: `https://YOUR_DOMAIN` (Caddy serves with auto-HTTPS)
- **Backend API**: `https://YOUR_DOMAIN/api`
- **API Documentation**: not published. FastAPI serves `/docs` and
  `/openapi.json` at the backend root. Caddy forwards `/api/*` and OAuth
  `/.well-known/oauth-*` discovery to the
  backend, so the interactive docs are reachable from inside the Compose
  network (or a local run) but not from the internet. This is deliberate — it
  keeps the schema and the try-it console off a public deployment.

For local development (with override file):

- **Frontend**: `http://localhost:3000`
- **Backend API**: `http://localhost:8000`
- **API Documentation**: `http://localhost:8000/docs`

## Legal Pages (Impressum, Privacy Policy)

Operators in Germany and elsewhere in the EU usually have to publish an
Impressum and a privacy policy. Their content identifies whoever runs the
deployment, so it is not part of this repository or the published images —
each operator supplies their own.

Put HTML fragments (no `<html>`/`<body>`, just headings, paragraphs and lists)
in the folder named by `LEGAL_PAGES_PATH` (default `./legal`, git-ignored):

| File | Served at |
|---|---|
| `impressum.html` | `/impressum` |
| `datenschutz.html` | `/datenschutz` |

The folder is mounted read-only into the frontend container and read on every
request, so edits go live without a restart. A page — and its link in the app
footer and on the sign-in screen — appears only when its file exists, so a
deployment without these files shows neither. The files must be readable by
the container's non-root user (`chmod 644`). Their HTML is rendered as-is and
treated as trusted, like the `Caddyfile`; the site's Content-Security-Policy
still blocks external scripts, styles and images in it.

To keep the files versioned without forking this repository, keep them in a
separate private repository and set `LEGAL_PAGES_PATH` to its checkout, e.g.
`LEGAL_PAGES_PATH=/opt/prompt-maker-deploy/legal`.

## Service Communication

All services run on the `prompt-maker-studio-network` Docker bridge network:
- The frontend container reaches the backend at `http://backend:8000` (server-side only)
- Caddy proxies `DOMAIN/api/*` and OAuth `/.well-known/oauth-*` discovery to
  `backend:8000`, rejects `/metrics*`, and sends other routes to `frontend:3000`
- Browsers reach the API same-origin at `https://DOMAIN/api` (never via the Docker-internal name)

## Monitoring and Maintenance

### View logs:
```bash
# All services
docker compose -f docker-compose.yml logs -f

# Specific service
docker compose -f docker-compose.yml logs -f backend
docker compose -f docker-compose.yml logs -f frontend
docker compose -f docker-compose.yml logs -f caddy
```

### Restart services:
```bash
# All services
docker compose -f docker-compose.yml restart

# Specific service
docker compose -f docker-compose.yml restart backend
```

### Update application:
```bash
# Option A: rebuild from source
git pull
docker compose -f docker-compose.yml up -d --build

# Option B: deploy a published release (if using docker-compose.prod.yml).
# Set IMAGE_TAG in .env to the version you want first — nothing floats.
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build
```

### Upgrading to 0.3.0:

0.3.0 changes stored data once, at the first start: migration
`023_recover_drifted_prompt_sections` rebuilds the sections of prompts whose
text was edited by hand (keeping the original as a version), and
`024_recover_unnamed_prompts` names old History entries and files them under
"Recovered history". Migration `025_version_notes` moves edit notes to the
versions they describe, stores the current-version note separately, and keeps
original notes in `legacy_note` for history and export. New snapshots include
variable settings; restoring older snapshots retains current settings. The
release also removes endpoints and the weekly-summary job.

1. Back up first (`make backup-db`) and copy the backup off the host.
2. Rehearse on a copy: restore that backup into a throwaway stack, start the new
   release against it, and check backend JSON logs for `migration_applied`
   events with versions `023_…`, `024_…` and `025_…`, then spot-check a few
   hand-edited prompts, the Recovered history folder, current/historical notes
   and exports.
   Restart the throwaway backend and confirm the migrations do not run again.
   Use an isolated stack and copied volume; never point a rehearsal at the live
   database. Do not copy credentials into release notes or logs.
3. Remove any `make send-weekly-summary` entry from the host crontab — the
   target no longer exists, and the job would fail every week.
4. After rehearsal and release approval, deploy, then sign in and open a saved
   prompt, fill it in and copy it. Check draft recovery, save/reload, version
   notes and restore, and historical evaluation labels before resuming normal use.

See [the release checklist](releases/0.3.0.md) for the publication record and
production-data rehearsal gates.

API clients of the removed endpoints (`/api/prompts/generate`,
`/api/prompts/history`, `/api/prompts/tags`, the Playground endpoints, and
`/api/analytics/dashboard`) stop working; MCP clients should refresh their tool
schemas (see [mcp.md](./mcp.md#contract-changes-in-030)).

### Upgrading to 0.5.0

0.5.0 is published; approve deployment separately before using its images.
See the [release record](releases/0.5.0.md) for immutable digests, validation and
remaining deployment gates. Upgrades from before 0.3.0 must also follow the
earlier recovery checklist.

1. Back up with the updated scripts, verify the archive and copy it off-host.
   Rehearse on an isolated backup copy before touching the live database.
2. Update Compose, `scripts/` and `monitoring/` with the release. Grafana mounts
   `scripts/grafana-entrypoint.sh` and refuses an empty or published placeholder
   `GRAFANA_ADMIN_PASSWORD`. Review private provider access: user-supplied local
   Ollama/vLLM URLs require deliberate `ALLOW_PRIVATE_LLM_URLS=true`; trusted
   operator server defaults remain supported without that opt-in.
3. Start the rehearsal backend and confirm a `migration_applied` JSON event for
   `026_user_auth_subject` and `027_oauth_grants`. Restart it and confirm neither
   version is applied again. Check existing accounts, saved prompts, version
   notes and evaluations.
   The migration runs through backend startup; do not execute reference SQL.
4. Sign in again and reauthorize MCP OAuth clients using their existing
   registrations. Old username-subject sessions and OAuth credentials without
   grant versions are rejected; pending OAuth codes and refresh tokens are
   cleared. Legacy passwords over 72 UTF-8 bytes need a password reset; verify
   the reset-email flow if any account is affected.
5. Verify provider connection tests, Try once and evaluation results using an
   approved provider/model. Local CI mocks AI calls; live calls may incur charges.
   Update API clients to page evaluation history beyond the default 50 runs.
6. Update custom metric queries and log parsers for the `pms_*` metrics and JSON
   events. If monitoring is enabled, verify its three provisioned dashboards and
   snapshot freshness as described in [monitoring](monitoring.md).

Migration 020's note-schema fix applies to upgrades crossing both 020 and 025.
It does not reconstruct already damaged note history; review
that against a verified backup before changing those records. Migrations remain
forward-only; rehearse the restore procedure below and agree the data-loss window
before deployment approval.

### Roll back a deployment:

Database migrations are forward-only; deploying an older image does not undo
schema changes. Create and verify a backup with `make backup-db` before every
release that includes a migration.

If the previous image is compatible with the current schema and no data
rollback is needed, redeploy its pinned `IMAGE_TAG` using the GHCR commands
above. If data or schema must also be rolled back, prepare the previous
backend container **before** restoring: `make restore-db` automatically starts
the existing backend container after success. Leaving the newer container in
place would let it reapply its migrations immediately to the restored data.

For a GHCR deployment, after approving the backup and data-loss window:

```bash
# Example only: replace this with the compatible previous published tag.
ROLLBACK_TAG=1.2.2
docker compose -f docker-compose.yml --profile backup stop db-backup backend
IMAGE_TAG="$ROLLBACK_TAG" docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
# Create the older backend container without starting it against the newer DB.
IMAGE_TAG="$ROLLBACK_TAG" docker compose -f docker-compose.yml -f docker-compose.prod.yml create --no-build backend
make restore-db BACKUP='backups/replace-with-verified-backup.sqlite3.gz'
IMAGE_TAG="$ROLLBACK_TAG" docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build
```

For source builds, build and create the compatible previous backend container
without starting it before invoking the restore helper. Resume the backup
profile explicitly if it was enabled: because it was stopped before the helper,
the helper will leave it stopped. Validate the restored application first.

The restore script integrity-checks the backup and preserves a
`.pre-restore-<timestamp>` copy of the replaced database. Restoring discards
all writes made after the selected backup, so confirm that data-loss window
before proceeding.

### Backup database:

Create an on-demand consistent SQLite backup from the `backend-data` volume:

```bash
make backup-db
```

Enable scheduled daily backups by starting Compose with the backup profile:

```bash
mkdir -p backups
BACKUP_UID=$(id -u) BACKUP_GID=$(id -g) BACKUP_INTERVAL_SECONDS=86400 \
  docker compose --profile backup -f docker-compose.yml up -d
```

Backups are written to `./backups/prompts-<timestamp>.sqlite3.gz` by the
non-root UID/GID supplied above, so the host operator retains ownership. Put
the same values in `.env` if the profile is managed without this one-shot
command. On-demand backups also run as the host operator. Archives have mode
`0600` and appear under their final name only after compression succeeds.

After each run the worker deletes scheduled backups older than
`BACKUP_RETENTION_DAYS` (default 14), so deleted user data does not live on
indefinitely in old backups. If your privacy policy states a retention period,
keep the two in sync. Container logs are capped at 3 × 10 MB per service in
`docker-compose.yml`; backend JSON logs exclude client IP addresses and request
content. See [monitoring](monitoring.md#logs-and-validation) for retained fields.

### Restore database:

Restore a tested backup (the command stops the backend and scheduled backup
worker first, then restarts them after a successful restore):

```bash
make restore-db BACKUP=backups/prompts-YYYYmmddTHHMMSSZ.sqlite3.gz
```

The restore script runs `PRAGMA integrity_check` before replacing the DB and
keeps a consistent `.pre-restore-<timestamp>` SQLite snapshot of the previous
database, including committed WAL data. It acquires exclusive SQLite access,
checkpoints WAL, removes old sidecars, and atomically replaces the database
while preserving its ownership and permissions. The restore container runs as
the backend's non-root UID/GID (`1000:1000`); the selected backup must be readable
by that account. If your host operator has a different UID, give that account
read access to the selected backup before restoring.

Stop any other process using this database before running a restore directly;
active SQLite users cause restoration to fail. If restoration fails, the Make
command leaves the services stopped so you can inspect the error before
restarting them. The scheduled worker restarts only if it was running before
the restore. Pre-restore snapshots contain user data; remove them when they
are no longer needed under your retention policy.

### Demo data

The `alex` demo account (`backend/scripts/seed_demo_user.py`) is a **local
development fixture only** — it uses a fixed password published in this
repository. Do not seed it on a deployed instance. See
[`docs/development.md`](./development.md#seed-the-demo-account) for the local
workflow.

## Troubleshooting

### Services can't communicate:
1. Verify all services are on the same network:
   ```bash
   docker network inspect prompt-maker_prompt-maker-studio-network
   ```

2. Inspect the declared service environment template:
   ```bash
   COMPOSE_DISABLE_ENV_FILE=1 docker compose --env-file /dev/null -f docker-compose.yml config --no-interpolate
   ```

   > This command inspects the declared template without opening the operator
   > environment file. `--no-interpolate` leaves `${VAR}` references unexpanded.
   > Never run plain `docker compose config` when you intend to share the output — it resolves
   > and prints every value from `.env`, including `SECRET_KEY`,
   > `LLM_ENCRYPTION_KEY`, `SMTP_PASSWORD`, and `GRAFANA_ADMIN_PASSWORD`.

### CORS errors:
1. Confirm the browser is using same-origin `/api`; the default topology should
   not produce a CORS request.
2. For a deliberately separate frontend origin, add its exact URL to
   `CORS_ORIGINS`, then restart the backend:
   ```bash
   docker compose -f docker-compose.yml restart backend
   ```

### Health check failures:
```bash
# Check backend health inside the production container
docker compose -f docker-compose.yml exec backend curl -fsS http://localhost:8000/

# View detailed health status
docker inspect prompt-maker-studio-backend | grep -A 10 Health
```

## Security Considerations

1. **Change default SECRET_KEY** in production
2. **Use HTTPS**: Caddy handles this automatically with Let's Encrypt. Confirm `COOKIE_SECURE=true` so session cookies are never sent in the clear
3. **Configure firewall** to only expose ports 80 and 443 (Caddy); block direct access to 3000 and 8000
4. **Regular backups** of the database volume
5. **Keep Docker images updated** through the source-build or pinned-GHCR
   update procedure above; use the same explicit Compose files used to deploy.

## Scaling limits

Prompt Maker Studio is built for a single backend instance and does not scale
horizontally today. This is a design constraint, not a configuration gap:

- **SQLite only.** There is no PostgreSQL or MySQL support. The migration
  runner (`backend/app/database/migrations/runner.py`) is SQLite-specific, and SQLite
  allows a single writer. Do not plan a deployment around swapping the
  database — see [SQLite as Primary Database](../product/DECISIONS.md).
- **One backend replica.** Multiple backends would contend for the same SQLite
  file over a shared volume. Load balancing across replicas is therefore not
  supported.
- **Vertical scaling and caching** are the available levers. Caddy already
  fronts the stack; the practical limits are CPU/memory on the single host.

Removing these limits would require porting the persistence layer and the
migration runner first.

## Support

For issues or questions, refer to:
- Main README.md
- `docs/development.md` for development setup
- API documentation at the backend's `/docs` endpoint (not exposed publicly)
