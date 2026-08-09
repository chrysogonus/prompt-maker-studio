# Docker Deployment Guide

## Overview

The application uses Docker and Docker Compose for containerized deployment.

## Structure

```
prompt-maker-studio/
├── docker-compose.yml           # Orchestrates all services
├── docker-compose.override.yml  # Local dev overrides (auto-applied by docker compose up)
├── docker-compose.prod.yml      # Production overrides — pulls pre-built images from GHCR
├── Caddyfile                    # Caddy reverse proxy configuration
├── backend/
│   └── Dockerfile               # Backend container
└── frontend/
    └── Dockerfile               # Frontend container
```

See `docs/deployment.md` for how `docker-compose.prod.yml` is used to deploy pinned GHCR images.

## Quick Start

**Follow the [Quick Start in `README.md`](../README.md#quick-start-with-docker) for
first-time setup.** `make setup` generates the required signing key, and the
direct local ports then work without editing domain placeholders. Set
`FRONTEND_URL=http://localhost:3000` only when testing reset-email links.

Once `.env` is configured:

```bash
# Start the application
make up

# View logs
make logs

# Stop the application
make down
```

## Docker Commands

### Build Images
```bash
make build
# or
docker compose build
```

### Start Containers
```bash
make up
# or
docker compose up -d
```

### Stop Containers
```bash
make down
# or
docker compose down
```

### View Logs
```bash
make logs
# or
docker compose logs -f
docker compose logs -f backend    # Backend only
docker compose logs -f frontend   # Frontend only
```

### Restart Services
```bash
make restart
# or
docker compose restart
```

### Rebuild and Restart
```bash
make sync-restart
# or
docker compose down && docker compose up -d --build
```

## Ports

The base `docker-compose.yml` does **not** expose host ports for the backend or frontend directly — they communicate internally over the Docker network. Caddy exposes public HTTP/HTTPS ports:

- **Caddy**: port 80 (HTTP) and 443 (HTTPS)

Prometheus and Grafana bind loopback-only host ports for local operator access —
`127.0.0.1:9090` and `127.0.0.1:3010`, respectively — but only when the opt-in
`monitoring` profile is started; they are absent from the default stack.

Caddy runs in production but is **excluded from the local stack**:
`docker-compose.override.yml` assigns it a `caddy` profile, so a local
`docker compose up` skips it rather than claiming :80/:443 and looping on
Let's Encrypt challenges for a placeholder `DOMAIN`. Production never loads that
override, so `docker compose -f docker-compose.yml up -d` still starts Caddy
with no extra flag. To run it locally anyway, set a `DOMAIN` that resolves to
this host and use `docker compose --profile caddy up -d`.

When running locally with `docker compose up` (which automatically applies `docker-compose.override.yml`), direct host ports are also mapped:

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

In production (using only `docker-compose.yml`), all traffic goes through Caddy.

## Volumes

The Docker setup uses:
- `backend-data` — Named Docker volume for database persistence at `/app/data/prompts.db`
- `caddy_data` — Stores Caddy's TLS certificates and ACME state
- `caddy_config` — Stores Caddy's runtime configuration
- `prometheus_data` — Stores Prometheus's time-series metrics data
- `grafana_data` — Stores Grafana's dashboards and settings

`docker-compose.yml` also defines `prometheus` and `grafana` services behind the opt-in
`monitoring` profile (`docker compose --profile monitoring up -d`; Grafana then requires
`GRAFANA_ADMIN_PASSWORD` in `.env`) and an optional
`db-backup` service gated behind the `backup` Compose profile — see `docs/deployment.md` for
enabling scheduled backups.

## Environment Variables

Compose reads configuration from the root `.env` on the host and injects only
the variables declared for each service. The file itself is not mounted into
the backend or frontend container.

```env
# Backend Configuration
# Non-Docker local runs only — docker-compose.yml hardcodes the container
# path (sqlite:////app/data/prompts.db, the persistent backend-data volume)
# and ignores this value on purpose.
DATABASE_URL=sqlite:///./prompts.db
# Cross-origin frontend/backend topologies only; unused in the default stack.
# CORS_ORIGINS=https://separate-frontend.example.com

# Authentication (required)
# Generate with: openssl rand -hex 32 — `make setup` does this for you when it
# creates .env. The backend refuses to start on a published placeholder, an
# unset value, or anything shorter than 32 characters.
SECRET_KEY=<64 hex characters from `openssl rand -hex 32`>
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Session cookie scope. Both are for deployment; leave them as-is locally.
# COOKIE_DOMAIN — leave unset in the default topology. The app and /api share
# one origin, so a host-only cookie already covers both and is narrowly scoped.
# COOKIE_SECURE — HTTPS-only. The code defaults to true; the local override
# (docker-compose.override.yml) and `.env.example` turn it off, because a
# Secure cookie is never sent back over plain HTTP.
COOKIE_DOMAIN=
COOKIE_SECURE=false

# Direct development ports bind only to loopback. Set 0.0.0.0 deliberately for
# remote-device testing on a trusted LAN; this also exposes the direct backend.
DEV_BIND_ADDRESS=127.0.0.1
# Optional host-port overrides
BACKEND_PORT=8000
FRONTEND_PORT=3000

# LLM access is bring-your-own — no operator API key. Each user connects
# their own provider in Settings → API access.

# Optional. Encrypts stored per-user provider keys. Defaults to a value
# derived from SECRET_KEY; set it explicitly to rotate JWT signing without
# invalidating stored credentials.
# LLM_ENCRYPTION_KEY=<Fernet key>

# Optional. Overrides the per-request provider timeout (default 30s hosted,
# 180s self-hosted).
# LLM_TIMEOUT_SECONDS=180

# Optional monthly usage ceilings (USD). Unset means unlimited. Users pay
# their own provider, so these cap how much billed activity the app will
# drive rather than protecting an operator wallet. Enforced before every
# billed call (Playground run, eval case/judge calls, refinement);
# GLOBAL_MONTHLY_BUDGET_USD's exhausted state is also reported by
# GET /api/prompts/config. Operator-controlled only.
# GLOBAL_MONTHLY_BUDGET_USD=50
# USER_MONTHLY_BUDGET_USD=5

# Password-reset links and email delivery
FRONTEND_URL=http://localhost:3000
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=Prompt Maker Studio <no-reply@example.com>

# Caddy Reverse Proxy (production only)
# See Caddyfile — read by the Caddy container at runtime. One domain serves
# both the app and the API (/api).
DOMAIN=yourdomain.com

# Monitoring (needed only for the opt-in `monitoring` profile)
GRAFANA_ADMIN_PASSWORD=change-this-to-a-secure-password

# Scheduled backups (needed only for the opt-in `backup` profile). Set UID/GID
# to `id -u` / `id -g` if the host account is not 1000:1000.
BACKUP_INTERVAL_SECONDS=86400
BACKUP_UID=1000
BACKUP_GID=1000
```

**No API URL variable**: browsers call `/api` on the origin that served the app, so nothing about the API location is compiled into the frontend bundle and one image works on any domain. Compose routes that path for you — Caddy in production, and the Next server's `API_PROXY_TARGET` rewrite (default `http://backend:8000`) when no proxy is in front.

**SQLite Path Explanation**:
- **Docker** (absolute path): `sqlite:////app/data/prompts.db`
  - Format: `sqlite:///` (3 slashes for protocol) + `/app/data/prompts.db` (absolute path) = 4 slashes total
- **Local** (relative path): `sqlite:///./prompts.db`
  - Format: `sqlite:///` (3 slashes for protocol) + `./prompts.db` (relative path) = 3 slashes total

The 4-slash version is required in Docker because the database must use an absolute path to ensure it's stored in the mounted volume at `/app/data/`.

## Networking

All services (`backend`, `frontend`, `caddy`) run on the `prompt-maker-studio-network` bridge network, allowing them to communicate using Docker's internal DNS (e.g., `http://backend:8000` from Caddy or the frontend container).

## Troubleshooting

### Containers won't start
```bash
# Check logs
docker compose logs

# Rebuild images
docker compose build --no-cache
docker compose up -d
```

### Port conflicts
If ports 3000 or 8000 are in use, set the local-override variables in `.env`
instead of changing the base Compose file:
```env
FRONTEND_PORT=3001
BACKEND_PORT=8001
```

### Database access
```bash
# Query database using Python (sqlite3 CLI not installed in slim image)
docker exec -it prompt-maker-studio-backend python -c "
import sqlite3, json
conn = sqlite3.connect('/app/data/prompts.db')
for row in conn.execute('SELECT id, user_id, fields, created_at FROM prompts'):
    print(row[0], row[1], json.loads(row[2]), row[3])
conn.close()
"

# Create a consistent backup from the Docker volume
make backup-db

# Restore an integrity-checked backup
make restore-db BACKUP=backups/prompts-YYYYmmddTHHMMSSZ.sqlite3.gz
```

### Clean slate
```bash
make clean
# or
docker compose down -v --rmi local
```

## Production Considerations

For production deployment:

1. Use proper secrets management (not `.env` files)
2. Plan around **SQLite only**. Prompt Maker Studio has no PostgreSQL or MySQL
   support: `backend/app/database/migrations.py` is a SQLite-specific migration
   runner, and the schema, backup, and restore tooling all assume a single
   database file. That also caps you at one backend replica — see
   [`product/DECISIONS.md`](../product/DECISIONS.md). Persist the
   `backend-data` volume and schedule `make backup-db` instead of reaching for
   a client/server database.
3. Set `DOMAIN` in `.env`; Caddy will obtain a TLS certificate automatically via Let's Encrypt
4. Deploy using only `docker-compose.yml` (without the override): `docker compose -f docker-compose.yml up -d`
5. Configure logging and monitoring
6. Set resource limits in `docker-compose.yml`
