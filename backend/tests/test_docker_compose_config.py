"""
Regression coverage for docker-compose.yml config choices that are easy to
silently reintroduce, without pulling in a YAML-parsing dependency.
"""

from pathlib import Path
import re

_REPO_ROOT = Path(__file__).parent.parent.parent
_COMPOSE_PATH = _REPO_ROOT / "docker-compose.yml"
_LOCAL_OVERRIDE_PATH = _REPO_ROOT / "docker-compose.override.yml"
_ENV_EXAMPLE_PATH = _REPO_ROOT / ".env.example"


def _service_block(compose_text: str, service_name: str) -> str:
    """Return a top-level service's raw text block (until the next 2-space-indented key)."""
    match = re.search(rf"\n  {re.escape(service_name)}:\n(.*?)(?=\n  \S|\Z)", compose_text, re.S)
    assert match, f"service {service_name!r} not found in docker-compose.yml"
    return match.group(1)


def _documented_settings() -> set[str]:
    """Every setting `.env.example` presents as live (commented-out lines excluded)."""
    return set(re.findall(r"^([A-Z][A-Z0-9_]*)=", _ENV_EXAMPLE_PATH.read_text(), re.M))


class TestDockerComposeSecretExposure:
    """Containers receive only the environment values listed for their service."""

    def test_frontend_service_does_not_mount_env_file(self):
        compose_text = _COMPOSE_PATH.read_text()
        frontend_block = _service_block(compose_text, "frontend")
        assert "/app/.env" not in frontend_block

    def test_backend_service_does_not_mount_env_file(self):
        compose_text = _COMPOSE_PATH.read_text()
        backend_block = _service_block(compose_text, "backend")
        assert "/app/.env" not in backend_block


class TestDockerComposeNoOperatorLLMKey:
    """LLM access is bring-your-own per user. Passing an operator-wide provider
    key into the container would be dead configuration at best, and at worst
    would suggest the app still falls back to one — it does not."""

    def test_backend_service_does_not_receive_an_operator_provider_key(self):
        compose_text = _COMPOSE_PATH.read_text()
        backend_block = _service_block(compose_text, "backend")
        assert "OPENAI_API_KEY" not in backend_block
        assert "ANTHROPIC_API_KEY" not in backend_block

    def test_backend_service_receives_the_credential_encryption_key(self):
        """Per-user provider keys are encrypted at rest; the operator can pin
        the key material independently of SECRET_KEY."""
        compose_text = _COMPOSE_PATH.read_text()
        backend_block = _service_block(compose_text, "backend")
        assert "LLM_ENCRYPTION_KEY" in backend_block


class TestDockerComposeDatabasePath:
    """DATABASE_URL must stay hardcoded to the volume path.

    Making it `${DATABASE_URL:-...}` looks like an improvement — the variable
    is documented, so honouring it seems more honest than ignoring it. It is
    not. The root `.env` carries the value for non-Docker local runs,
    `sqlite:///./prompts.db`, and a relative path inside the container
    resolves against WORKDIR to /app/prompts.db — outside the `backend-data`
    volume. The backend then starts on an empty database and reports itself
    healthy while every existing account appears to have vanished.
    """

    def test_database_url_is_not_interpolated_from_env(self):
        backend_block = _service_block(_COMPOSE_PATH.read_text(), "backend")
        assert "DATABASE_URL=${" not in backend_block

    def test_database_url_points_inside_the_mounted_volume(self):
        backend_block = _service_block(_COMPOSE_PATH.read_text(), "backend")
        assert "DATABASE_URL=sqlite:////app/data/prompts.db" in backend_block
        assert "backend-data:/app/data" in backend_block


class TestDockerComposeDocumentedSettingsReachTheBackend:
    """Every operator setting `.env.example` advertises must actually arrive.

    Compose injects only the variables listed for a service and the root `.env`
    is deliberately never mounted, so a setting documented in `.env.example`,
    README, and SECURITY.md but missing from the backend's `environment:` block
    is silently inert in every documented Docker deployment. That is how
    GLOBAL_MONTHLY_BUDGET_USD, USER_MONTHLY_BUDGET_USD, ADMIN_DIAGNOSTICS_TOKEN,
    REGISTER_RATE_LIMIT, LOGIN_RATE_LIMIT, and SMTP_TLS_MODE came to be
    advertised as operator controls while doing nothing — an operator who set a
    spend ceiling believing they were capped was not.

    Anything genuinely consumed elsewhere belongs in the exemption map below,
    with the reason, rather than being quietly dropped from this check.
    """

    # setting -> why the backend container legitimately does not receive it
    _NOT_BACKEND_FACING = {
        "DATABASE_URL": "hardcoded to the volume path; see TestDockerComposeDatabasePath",
        "UVICORN_RELOAD": "process env for `make dev-backend`; never enabled in a container",
        "DOMAIN": "read by the caddy service",
        "API_PROXY_TARGET": "read by the frontend (Next) service",
        "BACKEND_PORT": "host port mapping in docker-compose.override.yml",
        "FRONTEND_PORT": "host port mapping in docker-compose.override.yml",
        "DEV_BIND_ADDRESS": "host bind interface in docker-compose.override.yml",
        "GHCR_OWNER": "image coordinates in docker-compose.prod.yml",
        "IMAGE_TAG": "image coordinates in docker-compose.prod.yml",
        "GRAFANA_ADMIN_PASSWORD": "read by the grafana service (monitoring profile)",
        "BACKUP_INTERVAL_SECONDS": "read by the db-backup service (backup profile)",
        "BACKUP_UID": "container user for the db-backup service (backup profile)",
        "BACKUP_GID": "container user for the db-backup service (backup profile)",
    }

    def test_every_documented_backend_setting_is_forwarded(self):
        backend_block = _service_block(_COMPOSE_PATH.read_text(), "backend")
        missing = sorted(
            setting
            for setting in _documented_settings() - set(self._NOT_BACKEND_FACING)
            if not re.search(rf"^\s*-\s*{re.escape(setting)}=", backend_block, re.M)
        )
        assert not missing, (
            f"{missing} are documented in .env.example but never reach the backend "
            "container. Add them to the backend service's environment: block, or "
            "exempt them in _NOT_BACKEND_FACING with the reason."
        )

    def test_exemptions_still_correspond_to_documented_settings(self):
        """A stale exemption would mask a genuinely missing pass-through."""
        stale = sorted(set(self._NOT_BACKEND_FACING) - _documented_settings())
        # API_PROXY_TARGET ships commented out in .env.example; it stays exempt.
        stale = [setting for setting in stale if setting != "API_PROXY_TARGET"]
        assert not stale, f"{stale} are exempted but no longer documented in .env.example"


class TestDockerComposeLocalExposure:
    """Development-only ports stay on loopback unless the operator opts in."""

    def test_backend_port_defaults_to_loopback(self):
        backend_block = _service_block(_LOCAL_OVERRIDE_PATH.read_text(), "backend")
        expected_mapping = '"${DEV_BIND_ADDRESS:-127.0.0.1}:${BACKEND_PORT:-8000}:8000"'
        assert expected_mapping in backend_block

    def test_frontend_port_defaults_to_loopback(self):
        frontend_block = _service_block(_LOCAL_OVERRIDE_PATH.read_text(), "frontend")
        expected_mapping = '"${DEV_BIND_ADDRESS:-127.0.0.1}:${FRONTEND_PORT:-3000}:3000"'
        assert expected_mapping in frontend_block


class TestDockerComposeCaddyIsProductionOnly:
    """Caddy is the production edge and must stay out of the default local stack.

    It claims host :80/:443 and requests a certificate for whatever `DOMAIN`
    holds — `yourdomain.com` in the template `make setup` copies — so leaving it
    in the local stack greeted every new contributor with looping Let's Encrypt
    failures on the README's own first command. The split has to stay this exact
    shape: the profile belongs to the local override, which production never
    loads, so `docker compose -f docker-compose.yml up -d` still gets Caddy with
    no extra flag.
    """

    def test_base_compose_starts_caddy_without_a_profile(self):
        caddy_block = _service_block(_COMPOSE_PATH.read_text(), "caddy")
        assert "profiles:" not in caddy_block

    def test_local_override_moves_caddy_behind_a_profile(self):
        caddy_block = _service_block(_LOCAL_OVERRIDE_PATH.read_text(), "caddy")
        assert re.search(r"profiles:\s*\n\s*-\s*caddy", caddy_block)


class TestDockerComposeBackupUser:
    """The scheduled backup worker must not create root-owned host files."""

    def test_backup_worker_has_a_configurable_non_root_user(self):
        backup_block = _service_block(_COMPOSE_PATH.read_text(), "db-backup")
        assert 'user: "${BACKUP_UID:-1000}:${BACKUP_GID:-1000}"' in backup_block

    def test_backup_database_mount_stays_read_only(self):
        backup_block = _service_block(_COMPOSE_PATH.read_text(), "db-backup")
        assert "backend-data:/app/data:ro" in backup_block
