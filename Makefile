.PHONY: help setup install setup-venv lock check-locks check-locks-selftest check-secrets check-docker-context check-backup-worker security-images check-notices screenshots setup-e2e build up down restart sync-restart logs clean test test-cov test-file test-frontend test-e2e dev-backend dev-frontend smoke-smtp backup-db restore-db send-weekly-summary seed-demo-user ci-local lint-backend lint-frontend lint-fix build-local build-frontend build-backend security-backend security-frontend docker-smoke-test compose-check

# Interpreter used to create .venv. The backend declares requires-python >=3.12,
# but a distro `python3` is frequently older (e.g. 3.10 on Ubuntu 22.04), which
# makes the editable install fail outright — so pick the first 3.12+ binary found.
PYTHON_BIN := $(shell for p in python3.14 python3.13 python3.12 python3; do \
	if command -v $$p >/dev/null 2>&1 && $$p -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then \
		echo $$p; break; \
	fi; \
done)

# Virtual environment tool paths (absolute, so they work regardless of cd)
VENV      := $(CURDIR)/.venv
PYTHON    := $(VENV)/bin/python
PIP       := $(VENV)/bin/pip
PYTEST    := $(VENV)/bin/pytest
RUFF      := $(VENV)/bin/ruff
BANDIT    := $(VENV)/bin/bandit
# Deliberately not named PIP_AUDIT / PIP_COMPILE: make exports command-line
# variable overrides into every recipe's environment, and pip reads any
# PIP_<OPTION> environment variable as configuration. `PIP_COMPILE=pip-compile`
# reached pip as `--compile=pip-compile` and aborted the run.
PIPAUDIT   := $(VENV)/bin/pip-audit
PIPCOMPILE := $(VENV)/bin/pip-compile
FRONTEND_PORT ?= 3000
BACKEND_PORT ?= 8000

E2E_PROJECT := prompt-maker-studio-e2e
E2E_BACKEND_PORT := 18000
E2E_FRONTEND_PORT := 13000
# Never let test/screenshot Compose inherit the operator's real root .env.
E2E_COMPOSE := --env-file /dev/null -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.e2e.yml

# Default target
help:
	@echo "Prompt Maker - Available Commands"
	@echo "=================================="
	@echo "setup          - Initial setup (create .env file)"
	@echo "install        - Install dependencies for local development (backend incl. dev tools, frontend)"
	@echo "setup-venv     - Set up (or reuse) the backend venv with dev tools only (prerequisite for ci-local)"
	@echo "lock           - Regenerate backend/requirements*.lock from backend/pyproject.toml"
	@echo "check-locks    - Verify installed backend dependencies and committed lock freshness"
	@echo "check-locks-selftest - Verify check-locks fails when the lock generator fails"
	@echo "check-secrets  - Scan all Git history and non-ignored working-tree files for secrets"
	@echo "check-docker-context - Verify environment files cannot enter Docker build context"
	@echo "check-backup-worker - Verify scheduled backups run non-root with host ownership"
	@echo "build          - Build Docker images"
	@echo "up             - Start application with Docker"
	@echo "down           - Stop Docker containers"
	@echo "restart        - Restart Docker containers"
	@echo "sync-restart   - Stop, rebuild, and restart containers (for code changes)"
	@echo "logs           - Show Docker logs"
	@echo "clean          - Clean up containers, images, and build artifacts"
	@echo "test           - Run backend unit tests"
	@echo "test-cov       - Run tests with coverage report"
	@echo "test-file      - Run specific test file (use FILE=path/to/test.py)"
	@echo "test-frontend  - Run frontend unit tests"
	@echo "setup-e2e      - Install locked frontend dependencies and Playwright Chromium"
	@echo "test-e2e       - Run browser E2E tests against an isolated Compose stack"
	@echo "screenshots    - Capture the README screenshots into docs/assets/"
	@echo "dev-backend    - Run backend locally (without Docker)"
	@echo "dev-frontend   - Run frontend locally (without Docker)"
	@echo "smoke-smtp     - Validate SMTP config/connectivity for password reset"
	@echo "backup-db      - Create a SQLite backup from the backend-data volume"
	@echo "restore-db     - Restore a backup into backend-data (use BACKUP=path)"
	@echo "send-weekly-summary - Send the weekly digest email to opted-in users (cron entry point)"
	@echo "seed-demo-user - Seed (or re-seed) the 'alex' demo account with sample data"
	@echo ""
	@echo "CI/CD Commands"
	@echo "=================================="
	@echo "ci-local       - Run all CI checks locally (lint, security, build, test)"
	@echo "lint-backend   - Lint backend code with Ruff"
	@echo "lint-frontend  - Lint frontend code with TypeScript and ESLint"
	@echo "lint-fix       - Auto-fix lint errors (Ruff + ESLint)"
	@echo "build-local    - Fast build validation for backend and frontend (imports/tsc, no Docker)"
	@echo "build-frontend - Build frontend application (validates production build)"
	@echo "build-backend  - Validate backend application loads cleanly"
	@echo "security-backend  - Run security scans on backend"
	@echo "security-frontend - Run security audit on frontend"
	@echo "security-images   - Scan the built application images for known vulnerabilities"
	@echo "check-notices     - Verify THIRD_PARTY_NOTICES.md matches the built images"
	@echo "docker-smoke-test - Build Docker images and smoke-test the backend container (mirrors CI docker-build job)"
	@echo "compose-check     - Validate all docker-compose file combinations"

# Initial setup. Generates a real SECRET_KEY on the way in — the placeholder in
# .env.example is public, and the backend refuses to start with it, so copying
# the template unchanged would otherwise always fail on first boot.
setup:
	@if [ -f .env ]; then \
		echo ".env file already exists — leaving it untouched."; \
	else \
		echo "Creating .env file from .env.example..."; \
		cp .env.example .env; \
		if command -v openssl >/dev/null 2>&1; then \
			key=$$(openssl rand -hex 32); \
			sed -i.bak "s|^SECRET_KEY=.*|SECRET_KEY=$$key|" .env && rm -f .env.bak; \
			echo ".env file created with a freshly generated SECRET_KEY."; \
		else \
			echo ".env file created, but openssl was not found — set SECRET_KEY yourself:"; \
			echo "  python3 -c 'import secrets; print(secrets.token_hex(32))'"; \
		fi; \
		echo "Review .env before email, profile, or production use; see README.md."; \
	fi

# Install dependencies for local development (backend incl. dev tools, frontend)
install: setup
	@echo "Installing backend dependencies..."
	@if [ -z "$(PYTHON_BIN)" ]; then echo "❌ Python 3.12+ not found on PATH (see docs/development.md)"; exit 1; fi
	@if [ ! -d .venv ]; then $(PYTHON_BIN) -m venv .venv; fi
	@.venv/bin/pip install -q --upgrade pip setuptools wheel
	@.venv/bin/pip install -q --require-hashes -r backend/requirements-dev.lock
	@.venv/bin/pip install -q --no-build-isolation --no-deps -e "backend/"
	@echo "Installing frontend dependencies..."
	@cd frontend && npm install

# Set up (or reuse) the backend venv and install all requirements.
# pip/setuptools are upgraded first (as CI does): the setuptools bundled with a
# distro python3-venv predates PEP 621, and with it an editable install silently
# installs an "UNKNOWN 0.0.0" package carrying none of the dev tools.
setup-venv:
	@echo "Setting up backend virtual environment..."
	@if [ -z "$(PYTHON_BIN)" ]; then echo "❌ Python 3.12+ not found on PATH (see docs/development.md)"; exit 1; fi
	@if [ ! -d .venv ]; then $(PYTHON_BIN) -m venv .venv; fi
	@.venv/bin/pip install -q --upgrade pip setuptools wheel
	@.venv/bin/pip install -q --require-hashes -r backend/requirements-dev.lock
	@.venv/bin/pip install -q --no-build-isolation --no-deps -e "backend/"
	@echo "✅ Backend venv ready"

# Regenerate the backend dependency locks from backend/pyproject.toml.
# Run after changing any Python dependency and commit both files with it.
lock:
	@echo "Regenerating backend dependency locks..."
	@if [ ! -x $(VENV)/bin/pip-compile ]; then \
		echo "❌ pip-compile not found — run 'make setup-venv' first"; exit 1; \
	fi
	@cd backend && $(VENV)/bin/pip-compile --quiet --strip-extras --generate-hashes --allow-unsafe \
		--output-file=requirements.lock pyproject.toml
	@cd backend && $(VENV)/bin/pip-compile --quiet --strip-extras --generate-hashes --allow-unsafe --extra=dev \
		--output-file=requirements-dev.lock pyproject.toml
	@echo "✅ backend/requirements.lock and backend/requirements-dev.lock updated"

# Verify the committed locks still match what pip-compile resolves from
# pyproject.toml. The committed locks are copied into the scratch directory
# first because pip-compile seeds from an existing output file; without them
# this would re-resolve to the newest release of every transitive dependency
# and go red on upstream activity rather than on a change in this repository.
#
# `set -eu` is load-bearing, not boilerplate. Make separates these commands with
# semicolons in a single shell, so without it a pip-compile that died left the
# copied locks untouched and both diffs compared a file with itself — the gate
# reported success having never generated anything. `make check-locks-selftest`
# guards against that regression.
check-locks:
	@echo "Checking backend dependency consistency..."
	@$(PIP) check
	@set -eu; \
		tmp_dir=$$(mktemp -d); \
		trap 'rm -r "$$tmp_dir"' EXIT; \
		cp backend/pyproject.toml backend/requirements.lock backend/requirements-dev.lock "$$tmp_dir/"; \
		cd "$$tmp_dir"; \
		$(PIPCOMPILE) --quiet --strip-extras --generate-hashes --allow-unsafe \
			--output-file=requirements.lock pyproject.toml; \
		$(PIPCOMPILE) --quiet --strip-extras --generate-hashes --allow-unsafe --extra=dev \
			--output-file=requirements-dev.lock pyproject.toml; \
		diff -u "$(CURDIR)/backend/requirements.lock" requirements.lock; \
		diff -u "$(CURDIR)/backend/requirements-dev.lock" requirements-dev.lock
	@echo "✅ Backend dependency locks are consistent and current"

# Regression guard for check-locks: substitute a generator that always fails and
# assert the gate goes red. Before the `set -eu` fix this reported success.
check-locks-selftest:
	@echo "Checking that check-locks fails when the lock generator fails..."
	@if $(MAKE) --no-print-directory check-locks PIPCOMPILE=/bin/false >/dev/null 2>&1; then \
		echo "❌ check-locks reported success with a failing pip-compile"; exit 1; \
	fi
	@echo "✅ check-locks fails closed when the lock generator fails"

# Build Docker images
build:
	@echo "Building Docker images..."
	@docker compose build

# Start Docker containers
up: setup
	@echo "Starting application with Docker..."
	@docker compose up -d
	@echo "Application started!"
	@echo "Frontend: http://localhost:$(FRONTEND_PORT)"
	@echo "Backend API: http://localhost:$(BACKEND_PORT)"
	@echo "API Docs: http://localhost:$(BACKEND_PORT)/docs"

# Stop Docker containers
down:
	@echo "Stopping Docker containers..."
	@docker compose down

# Restart Docker containers
restart:
	@echo "Restarting Docker containers..."
	@docker compose restart

# Stop, rebuild, and restart containers (for code changes)
sync-restart:
	@echo "Stopping containers..."
	@docker compose down
	@echo "Rebuilding images..."
	@docker compose build
	@echo "Starting containers..."
	@docker compose up -d
	@echo "Application restarted with latest changes!"
	@echo "Frontend: http://localhost:$(FRONTEND_PORT)"
	@echo "Backend API: http://localhost:$(BACKEND_PORT)"
	@echo "API Docs: http://localhost:$(BACKEND_PORT)/docs"

# Show Docker logs
logs:
	@docker compose logs -f

# Clean up everything
clean:
	@echo "Cleaning up..."
	@docker compose down -v --rmi local
	@rm -rf backend/__pycache__ backend/app/__pycache__
	@rm -rf .venv frontend/node_modules frontend/.next
	@echo "Cleanup complete."

# Run backend unit tests
test:
	@echo "Running backend tests..."
	@cd backend && \
		$(PIP) install -q -r requirements-dev.lock && \
		$(PIP) install -q --no-build-isolation --no-deps -e "." && \
		$(PYTEST)

# Run tests with coverage
test-cov:
	@echo "Running backend tests with coverage..."
	@cd backend && \
		$(PYTEST) --cov=app --cov-report=term-missing --cov-report=xml --cov-report=html --cov-fail-under=90 -v

# Run specific test file
test-file:
	@if [ -z "$(FILE)" ]; then \
		echo "Usage: make test-file FILE=tests/test_api.py"; \
	else \
		echo "Running tests in $(FILE)..."; \
		cd backend && \
		$(PIP) install -q -r requirements-dev.lock && \
		$(PIP) install -q --no-build-isolation --no-deps -e "." && \
		$(PYTEST) $(FILE) -v; \
	fi


# Run frontend unit tests. Coverage is collected here rather than in a separate
# target so the command CONTRIBUTING.md tells contributors to run is the same
# gate CI enforces — a floor only CI checks is a floor people discover late.
test-frontend:
	@echo "Running frontend unit tests..."
	@cd frontend && \
		npm ci && \
		npm run test:coverage
	@echo "✅ Frontend tests passed"

# Install the locked frontend dependencies and browser used by the Playwright E2E suite.
setup-e2e:
	@cd frontend && \
		npm ci && \
		./node_modules/.bin/playwright install chromium

# Run browser tests against isolated frontend/backend Compose services.
# The project name, ports, and volume are separate from a developer's local stack.
test-e2e:
	@set -e; \
	cleanup() { \
		COMPOSE_PROJECT_NAME=$(E2E_PROJECT) GRAFANA_ADMIN_PASSWORD=e2e-grafana-password docker compose $(E2E_COMPOSE) down -v --remove-orphans > /dev/null 2>&1 || true; \
	}; \
	cleanup; \
	trap cleanup EXIT; \
	COMPOSE_PROJECT_NAME=$(E2E_PROJECT) \
	BACKEND_PORT=$(E2E_BACKEND_PORT) \
	FRONTEND_PORT=$(E2E_FRONTEND_PORT) \
	SECRET_KEY=e2e-local-secret-key-not-for-production \
	GRAFANA_ADMIN_PASSWORD=e2e-grafana-password \
	docker compose $(E2E_COMPOSE) up -d --build --wait backend frontend; \
	cd frontend && E2E_BASE_URL=http://localhost:$(E2E_FRONTEND_PORT) npm run test:e2e

# Capture the README screenshots against a throwaway Compose stack.
# Deliberately separate from test-e2e: this writes PNGs into docs/assets/.
screenshots:
	@set -e; \
	cleanup() { \
		COMPOSE_PROJECT_NAME=$(E2E_PROJECT) GRAFANA_ADMIN_PASSWORD=e2e-grafana-password docker compose $(E2E_COMPOSE) down -v --remove-orphans > /dev/null 2>&1 || true; \
	}; \
	cleanup; \
	trap cleanup EXIT; \
	COMPOSE_PROJECT_NAME=$(E2E_PROJECT) \
	BACKEND_PORT=$(E2E_BACKEND_PORT) \
	FRONTEND_PORT=$(E2E_FRONTEND_PORT) \
	SECRET_KEY=e2e-local-secret-key-not-for-production \
	GRAFANA_ADMIN_PASSWORD=e2e-grafana-password \
	docker compose $(E2E_COMPOSE) up -d --build --wait backend frontend; \
	COMPOSE_PROJECT_NAME=$(E2E_PROJECT) \
	GRAFANA_ADMIN_PASSWORD=e2e-grafana-password \
	docker compose $(E2E_COMPOSE) exec -T -e SEED_DEMO_USER=1 \
		backend python -m scripts.seed_demo_user; \
	mkdir -p docs/assets; \
	cd frontend && \
		E2E_BASE_URL=http://localhost:$(E2E_FRONTEND_PORT) \
		CAPTURE_SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
	@echo "✅ Screenshots written to docs/assets/ — review them before committing"

# Run backend locally
dev-backend:
	@echo "Starting backend locally..."
	@cd backend && \
		$(PIP) install -q -r requirements.lock && \
		$(PIP) install -q --no-build-isolation --no-deps -e "." && \
		$(PYTHON) run.py

# Run frontend locally
dev-frontend:
	@echo "Starting frontend locally..."
	@cd frontend && \
		if [ ! -d node_modules ]; then npm install; fi && \
		npm run dev


# Create a one-off backup from the backend-data volume
backup-db:
	@mkdir -p backups
	@docker run --rm \
		-v prompt-maker_backend-data:/app/data:ro \
		-v $(CURDIR)/backups:/backups \
		-v $(CURDIR)/scripts:/scripts:ro \
		python:3.12-slim \
		python /scripts/backup_sqlite.py --db /app/data/prompts.db --out /backups --label prompts

# Restore a backup into the backend-data volume. Stop backend first.
restore-db:
	@if [ -z "$(BACKUP)" ]; then \
		echo "Usage: make restore-db BACKUP=backups/prompts-YYYYmmddTHHMMSSZ.sqlite3.gz"; \
		exit 1; \
	fi
	@docker compose stop backend
	@docker run --rm \
		-v prompt-maker_backend-data:/app/data \
		-v $(CURDIR):/workspace \
		-v $(CURDIR)/scripts:/scripts:ro \
		python:3.12-slim \
		python /scripts/restore_sqlite.py --backup /workspace/$(BACKUP) --db /app/data/prompts.db
	@docker compose start backend

# Send weekly summary emails to opted-in users (run weekly via host crontab)
send-weekly-summary:
	@docker compose exec backend python -m scripts.send_weekly_summary_email

# Seed (or re-seed) the "alex" demo account with realistic sample data
seed-demo-user:
	@cd backend && SEED_DEMO_USER=1 $(PYTHON) scripts/seed_demo_user.py

# Validate SMTP configuration and connectivity
smoke-smtp:
	@echo "Checking SMTP configuration and connectivity..."
	@cd backend && \
		$(PYTHON) -c "from app.services.email_service import check_smtp_connection; check_smtp_connection(); print('SMTP check passed')"

# ============================================
# CI/CD Commands
# ============================================

# Run all CI checks locally (mimics GitHub Actions)
# Prerequisite: run `make setup-venv` once to create the virtual environment.
# Also requires a running Docker daemon (used by docker-smoke-test and compose-check).
ci-local:
	@echo "Running all CI checks locally..."
	@echo ""
	@$(MAKE) check-secrets
	@echo ""
	@$(MAKE) check-locks
	@echo ""
	@$(MAKE) check-locks-selftest
	@echo ""
	@$(MAKE) lint-backend
	@echo ""
	@$(MAKE) lint-frontend
	@echo ""
	@$(MAKE) security-backend
	@echo ""
	@$(MAKE) security-frontend
	@echo ""
	@$(MAKE) build-local
	@echo ""
	@$(MAKE) test-frontend
	@echo ""
	@$(MAKE) test-e2e
	@echo ""
	@$(MAKE) test-cov
	@echo ""
	@$(MAKE) compose-check
	@echo ""
	@$(MAKE) check-backup-worker
	@echo ""
	@$(MAKE) check-docker-context
	@echo ""
	@$(MAKE) docker-smoke-test
	@echo ""
	@$(MAKE) security-images
	@echo ""
	@$(MAKE) check-notices
	@echo ""
	@echo "✅ All CI checks passed! Ready to push."

# Scan every reachable commit plus the current tracked/non-ignored working tree.
# Staging the directory scan through git's file inventory is deliberate: a
# developer's ignored real .env must never be opened by local tooling.
GITLEAKS_IMAGE := ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
check-secrets:
	@echo "Scanning Git history and working tree for secrets..."
	@set -eu; \
		tmp_dir=$$(mktemp -d); \
		trap 'rm -r "$$tmp_dir"' EXIT; \
		git ls-files -z --cached --others --exclude-standard \
			| tar --null -T - -cf - \
			| tar -xf - -C "$$tmp_dir"; \
		docker run --rm -v "$(CURDIR):/repo:ro" $(GITLEAKS_IMAGE) \
			git --no-banner --redact --verbose --log-opts="--all" /repo; \
		docker run --rm -v "$$tmp_dir:/scan:ro" $(GITLEAKS_IMAGE) \
			dir --no-banner --redact --verbose /scan
	@echo "✅ No secrets found in Git history or the working tree"

check-docker-context:
	@echo "Checking Docker build-context exclusions..."
	@$(PYTHON_BIN) scripts/check_docker_context.py

check-backup-worker:
	@echo "Checking non-root backup-worker ownership..."
	@$(PYTHON_BIN) scripts/check_backup_worker.py

# Lint backend code
lint-backend:
	@echo "Linting backend code with Ruff..."
	@cd backend && \
		echo "→ Running Ruff check..." && \
		$(RUFF) check app/ tests/ && \
		echo "→ Running Ruff format check..." && \
		$(RUFF) format --check app/ tests/
	@echo "✅ Backend linting passed"

# Lint frontend
lint-frontend:
	@echo "Linting frontend code with TypeScript and ESLint..."
	@cd frontend && \
		npm ci && \
		echo "→ Running TypeScript check..." && \
		npx tsc --noEmit && \
		echo "→ Running ESLint..." && \
		npx eslint src/ e2e/ playwright.config.ts
	@echo "✅ Frontend linting passed"

# Auto-fix lint errors for backend (Ruff) and frontend (ESLint)
lint-fix:
	@echo "Auto-fixing lint errors..."
	@echo "→ Fixing backend with Ruff..."
	@cd backend && \
		$(RUFF) check --fix app/ tests/ && \
		$(RUFF) format app/ tests/
	@echo "→ Fixing frontend with ESLint..."
	@cd frontend && \
		npm ci --silent && \
		npx eslint --fix src/
	@echo "✅ Auto-fix complete"

# Fast build validation for backend and frontend (imports/tsc only — no Docker).
# For full parity with CI's docker-build job (actual image builds + smoke test), also run `make docker-smoke-test`.
build-local:
	@echo "Running build validation (backend + frontend)..."
	@$(MAKE) build-backend
	@echo ""
	@$(MAKE) build-frontend
	@echo "✅ Build validation passed"

# Build frontend application
build-frontend:
	@echo "Building frontend application..."
	@cd frontend && \
		npm ci && \
		npm run build
	@echo "✅ Frontend build passed"

# Validate backend application loads cleanly
build-backend:
	@echo "Validating backend application..."
	@cd backend && \
		echo "→ Verifying app imports and instantiation..." && \
		SECRET_KEY=$$($(PYTHON) -c 'import secrets; print(secrets.token_hex(64))') \
		$(PYTHON) -c "from app.main import app; print('App loaded successfully')"
	@echo "✅ Backend build passed"

# Security scan backend
security-backend:
	@echo "Running security scans on backend..."
	@cd backend && \
		echo "→ Running Bandit..." && \
		$(BANDIT) -r app/ -f json -o bandit-report.json || true && \
		$(BANDIT) -r app/ -ll -f screen && \
		echo "→ Running pip-audit..." && \
		$(PIPAUDIT) --desc
	@echo "✅ Backend security checks passed"

# Security audit frontend
# The gate runs with --omit=dev: shipped code is the production dependency tree
# only (the Docker image never installs devDependencies). Lint/test tooling
# regularly carries advisories with no non-breaking fix — e.g. brace-expansion
# reached through eslint-plugin-import's pinned minimatch@3 — and blocking on
# those would mean either downgrading ESLint or disabling the gate entirely.
# The full tree is still printed above so dev-only advisories stay visible.
security-frontend:
	@echo "Running security audit on frontend..."
	@cd frontend && \
		npm ci && \
		echo "→ Running npm audit (full tree, informational)..." && \
		npm audit --audit-level=moderate || true && \
		echo "→ Running npm audit (production dependencies, gating)..." && \
		npm audit --omit=dev --audit-level=moderate
	@echo "✅ Frontend security audit passed"

# Verify the committed third-party notices still match the built images.
# Requires the :test images — run docker-smoke-test first.
check-notices:
	@echo "Checking THIRD_PARTY_NOTICES.md against the built images..."
	@$(PYTHON) scripts/check_third_party_notices.py

# Scan the built application images for known, fixable vulnerabilities.
# Mirrors CI's Trivy step so a green ci-local means a green pipeline.
#
# Deliberately scoped to the two images this project builds. The optional
# monitoring images are third-party and carry upstream advisories nothing here
# can fix — they are behind the `monitoring` Compose profile for that reason.
TRIVY_VERSION := 0.65.0
security-images:
	@echo "Scanning application images for known vulnerabilities..."
	@for service in backend frontend; do \
		echo "→ prompt-maker-studio-$$service:test"; \
		docker run --rm \
			-v /var/run/docker.sock:/var/run/docker.sock \
			-v trivy-cache:/root/.cache/trivy \
			aquasec/trivy:$(TRIVY_VERSION) image \
			--scanners vuln --severity HIGH,CRITICAL --ignore-unfixed \
			--exit-code 1 --quiet "prompt-maker-studio-$$service:test" || exit 1; \
	done
	@echo "✅ No fixable HIGH/CRITICAL vulnerabilities in the application images"

# Build Docker images and smoke-test the backend container (mirrors CI's docker-build job)
docker-smoke-test:
	@echo "Building backend Docker image..."
	@docker build -f backend/Dockerfile -t prompt-maker-studio-backend:test .
	@echo "Building frontend Docker image..."
	@docker build -f frontend/Dockerfile -t prompt-maker-studio-frontend:test .
	@echo "→ Verifying image licensing material..."
	@docker run --rm prompt-maker-studio-backend:test \
		sh -c 'test -f /licenses/LICENSE && test -f /licenses/NOTICE && test -f /licenses/THIRD_PARTY_NOTICES.md'
	@docker run --rm prompt-maker-studio-frontend:test \
		sh -c 'test -f /licenses/LICENSE && test -f /licenses/NOTICE && test -f /licenses/THIRD_PARTY_NOTICES.md && ! find /app/node_modules -path "*sharp-libvips*" -print -quit | grep -q .'
	@echo "→ Starting backend smoke test container..."
	@docker rm -f backend-smoke-local > /dev/null 2>&1 || true
	@docker run -d \
		--name backend-smoke-local \
		-p 18000:8000 \
		-e DATABASE_URL=sqlite:////app/data/prompts.db \
		-e SECRET_KEY=$$(openssl rand -hex 32) \
		prompt-maker-studio-backend:test > /dev/null
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do \
		if curl -sf http://localhost:18000/ > /dev/null 2>&1; then \
			echo "✅ Backend healthy after attempt $$i"; \
			docker rm -f backend-smoke-local > /dev/null; \
			exit 0; \
		fi; \
		echo "Attempt $$i/15: not ready, waiting..."; \
		sleep 2; \
	done; \
	echo "❌ Backend did not become healthy within 30 seconds"; \
	docker logs backend-smoke-local 2>&1 || true; \
	docker rm -f backend-smoke-local > /dev/null 2>&1 || true; \
	exit 1
	@echo "✅ Docker build + smoke test passed"

# Validate all docker-compose file combinations parse correctly
compose-check:
	@echo "Validating Docker Compose configurations..."
	@GRAFANA_ADMIN_PASSWORD=check docker compose -f docker-compose.yml config --quiet
	@GRAFANA_ADMIN_PASSWORD=check docker compose -f docker-compose.yml -f docker-compose.override.yml config --quiet
	@GRAFANA_ADMIN_PASSWORD=check docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.e2e.yml config --quiet
	@GRAFANA_ADMIN_PASSWORD=check GHCR_OWNER=check IMAGE_TAG=check docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
	@echo "✅ Compose configuration valid"
