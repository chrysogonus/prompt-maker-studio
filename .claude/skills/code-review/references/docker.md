# Docker Review Checklist

## Dockerfile Best Practices

### Base Image

- [ ] A specific, pinned base image tag is used — never `latest` in production (`FROM python:3.12.4-slim`, not `FROM python:latest`).
- [ ] A minimal base image is used (`-slim`, `-alpine`, `distroless`) rather than a full OS image unless a larger image is required.
- [ ] The base image is from an official or trusted source.

### Layer and Cache Optimization

- [ ] Dependencies are installed before copying application code so Docker's layer cache is used effectively.
- [ ] Package manager cache is cleared in the same `RUN` layer it is created (`apt-get clean && rm -rf /var/lib/apt/lists/*`).
- [ ] Multiple `RUN` commands that logically belong together are chained with `&&` to reduce layer count.
- [ ] `.dockerignore` exists and excludes: `.git`, `__pycache__`, `node_modules`, `.env`, test files, docs.

### Security

- [ ] The container does NOT run as `root`. A non-root user is created and set with `USER`.
- [ ] No secrets, credentials, API keys, or `.env` files are `COPY`-ed into the image.
- [ ] `ARG` is not used to pass secrets that end up in a layer (they appear in `docker history`). Use BuildKit secrets or runtime env vars instead.
- [ ] `COPY` is used instead of `ADD` unless the tar-extraction or URL-fetch behavior of `ADD` is explicitly needed.
- [ ] Only necessary ports are `EXPOSE`-d.

### Multi-Stage Builds

- [ ] Multi-stage builds are used when the build toolchain (compilers, dev dependencies) must not be present in the final image.
- [ ] Build artifacts are `COPY --from=builder` into a clean final stage.

### Metadata and Clarity

- [ ] `WORKDIR` is set explicitly instead of relying on the default root.
- [ ] `CMD` vs `ENTRYPOINT` is used correctly:
  - `ENTRYPOINT` for the main executable that shouldn't be overridden.
  - `CMD` for default arguments that can be overridden at runtime.
  - Exec form (`["executable", "arg"]`) preferred over shell form to avoid shell signal-handling issues.
- [ ] `HEALTHCHECK` defined for long-running services.

## docker-compose.yml Best Practices

- [ ] A specific image tag is pinned, not `latest`.
- [ ] Secrets and credentials are injected via environment variables from a `.env` file or secret manager — not hardcoded in the compose file.
- [ ] The `.env` file used by compose is listed in `.gitignore` — an `.env.example` is committed instead.
- [ ] `restart: unless-stopped` or `restart: always` is set for services that must be resilient.
- [ ] Resource limits (`mem_limit`, `cpus`) are set for production-grade services.
- [ ] Named volumes are used instead of host-path bind mounts for persistent data in production.
- [ ] Service dependencies are declared with `depends_on` and ideally `condition: service_healthy`.
- [ ] Networks are explicitly defined — do not rely on the default network for service isolation.
- [ ] No privileged mode (`privileged: true`) unless absolutely required, with a comment explaining why.
- [ ] Port mappings bind to `127.0.0.1` for services that should not be externally accessible (`"127.0.0.1:5432:5432"` not `"5432:5432"`).
