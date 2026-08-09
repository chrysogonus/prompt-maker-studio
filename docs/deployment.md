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

> **Scaling constraint**: Run exactly one backend replica. The backend applies
> SQLite migrations automatically during startup; that design is not safe for
> rolling or concurrent multi-replica startup. Introduce an external migration
> job and a multi-writer database before scaling the backend horizontally.

> **Local development**: `docker compose up` automatically applies `docker-compose.override.yml`, which adds direct host port mappings (3000 and 8000) in addition to Caddy. Do not use the override file in production.

## Prerequisites

- Docker and Docker Compose installed on the VM
- Git (to clone the repository)
- A domain name or IP address for accessing the application (optional but recommended)

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
DATABASE_URL=sqlite:////app/data/prompts.db
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

# No LLM API key here — access is bring-your-own, configured per user in
# Settings → API access. Optionally pin the credential-encryption key so
# rotating SECRET_KEY doesn't invalidate stored provider keys:
# LLM_ENCRYPTION_KEY=<Fernet key>

# Optional monthly usage ceilings (USD); unset means unlimited.
# See docs/docker.md's Environment Variables section.
# GLOBAL_MONTHLY_BUDGET_USD=50
# USER_MONTHLY_BUDGET_USD=5

# Frontend Configuration
# No API URL to set — browsers call /api on YOUR_DOMAIN and Caddy routes it to
# the backend. FRONTEND_URL is used server-side to build password-reset links.
FRONTEND_URL=https://YOUR_DOMAIN

# SMTP (required for password-reset emails)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=Prompt Maker Studio <no-reply@yourdomain.com>

# Caddy Reverse Proxy
# One domain serves both the app and the API (/api); Caddy obtains TLS for it
DOMAIN=yourdomain.com

# Monitoring Configuration
# Required only if you start the opt-in `monitoring` profile; the default
# stack does not include Grafana. Generate with: openssl rand -hex 16
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

6. **GRAFANA_ADMIN_PASSWORD**: Needed only for the opt-in monitoring stack (`docker compose -f docker-compose.yml --profile monitoring up -d`). Prometheus and Grafana are large third-party images carrying upstream advisories this project cannot fix, so the default stack — `backend`, `frontend`, `caddy` — leaves them out. Enable them deliberately; both bind to loopback only.

## Deployment Steps

### Option 1: Standard Deployment (with Caddy + Auto-TLS)

The repo ships a `Caddyfile` and a `caddy` service in `docker-compose.yml`. Caddy automatically obtains and renews TLS certificates from Let's Encrypt. All you need are two DNS records pointing to your VM.

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
- Set `IMAGE_TAG` in `.env` to a published version (`1.2.3`) or `sha-<short>` tag. The publish job's summary prints the immutable `@sha256:` digest for each image — prefer that for anything you intend to reproduce.
- If the packages are private, authenticate once:
  ```bash
  echo $GITHUB_PAT | docker login ghcr.io -u <github-username> --password-stdin
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

This exposes ports 3000 and 8000 directly on the host in addition to the Caddy service.

## Accessing the Application

After production deployment:

- **Frontend**: `https://YOUR_DOMAIN` (Caddy serves with auto-HTTPS)
- **Backend API**: `https://YOUR_DOMAIN/api`
- **API Documentation**: not published. FastAPI serves `/docs` and
  `/openapi.json` at the backend root, and Caddy routes only `/api/*` to the
  backend, so the interactive docs are reachable from inside the Compose
  network (or a local run) but not from the internet. This is deliberate — it
  keeps the schema and the try-it console off a public deployment.

For local development (with override file):

- **Frontend**: `http://localhost:3000`
- **Backend API**: `http://localhost:8000`
- **API Documentation**: `http://localhost:8000/docs`

## Service Communication

All services run on the `prompt-maker-studio-network` Docker bridge network:
- The frontend container reaches the backend at `http://backend:8000` (server-side only)
- Caddy proxies `DOMAIN/api/*` to `backend:8000` and everything else to `frontend:3000`
- Browsers reach the API same-origin at `https://DOMAIN/api` (never via the Docker-internal name)

## Monitoring and Maintenance

### View logs:
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f caddy
```

### Restart services:
```bash
# All services
docker compose restart

# Specific service
docker compose restart backend
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

### Roll back a deployment:

Database migrations are forward-only; deploying an older image does not undo
schema changes. Create and verify a backup with `make backup-db` before every
release that includes a migration.

If the release did not apply a bad migration, redeploy the previous pinned
`IMAGE_TAG` using the GHCR commands above. If data or schema must also be
rolled back, stop the backend, restore the pre-deploy backup with
`make restore-db BACKUP=backups/<backup>.sqlite3.gz`, then deploy the previous
image. The restore script integrity-checks the backup and preserves a
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
command.

### Restore database:

Stop the backend, restore a tested backup, and restart the backend:

```bash
make restore-db BACKUP=backups/prompts-YYYYmmddTHHMMSSZ.sqlite3.gz
```

The restore script runs `PRAGMA integrity_check` before replacing the DB and keeps a `.pre-restore-<timestamp>` copy of the previous database inside the Docker volume.

### Weekly summary emails:

Users who opt into Settings → Notifications → "Weekly summary" get a digest
email of their past-7-days usage. There is no in-process scheduler — the send
is a one-shot script run against the already-running `backend` container:

```bash
make send-weekly-summary
```

Schedule it weekly via host crontab (confirm the server's local timezone
before picking a time — this isn't tracked elsewhere in the deployment):

```cron
0 8 * * 1 cd /opt/prompt-maker-studio && make send-weekly-summary >> /var/log/prompt-maker-weekly-summary.log 2>&1
```

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

2. Check which environment variables each service receives:
   ```bash
   docker compose config --no-interpolate
   ```

   > `--no-interpolate` leaves `${VAR}` references unexpanded. Never run plain
   > `docker compose config` when you intend to share the output — it resolves
   > and prints every value from `.env`, including `SECRET_KEY`,
   > `LLM_ENCRYPTION_KEY`, `SMTP_PASSWORD`, and `GRAFANA_ADMIN_PASSWORD`.

### CORS errors:
1. Confirm the browser is using same-origin `/api`; the default topology should
   not produce a CORS request.
2. For a deliberately separate frontend origin, add its exact URL to
   `CORS_ORIGINS`, then restart the backend:
   ```bash
   docker compose restart backend
   ```

### Health check failures:
```bash
# Check backend health
curl http://localhost:8000/

# View detailed health status
docker inspect prompt-maker-studio-backend | grep -A 10 Health
```

## Security Considerations

1. **Change default SECRET_KEY** in production
2. **Use HTTPS**: Caddy handles this automatically with Let's Encrypt. Confirm `COOKIE_SECURE=true` so session cookies are never sent in the clear
3. **Configure firewall** to only expose ports 80 and 443 (Caddy); block direct access to 3000 and 8000
4. **Regular backups** of the database volume
5. **Keep Docker images updated**:
   ```bash
   docker compose pull
   docker compose up -d
   ```

## Scaling limits

Prompt Maker Studio is built for a single backend instance and does not scale
horizontally today. This is a design constraint, not a configuration gap:

- **SQLite only.** There is no PostgreSQL or MySQL support. The migration
  runner (`backend/app/database/migrations.py`) is SQLite-specific, and SQLite
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
