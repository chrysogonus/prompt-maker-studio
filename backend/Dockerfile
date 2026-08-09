# Pinned by digest so rebuilding this commit retrieves the same bytes. The
# readable tag stays in the comment; Dependabot's docker ecosystem updates
# both together.
FROM python:3.12-slim@sha256:d657ab0ade19f404a6ccc883ab399540de667aff751748ce23c07330c5a89e64

WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install runtime dependencies from the transitive lock rather than resolving
# pyproject.toml at build time. pyproject.toml pins only direct dependencies,
# so without the lock the transitive set — and with it the vulnerability and
# license inventory — drifts between otherwise identical builds.
# The app itself is imported from WORKDIR, so it needs no pip install.
COPY backend/requirements.lock .
# --require-hashes: the lock carries a hash per distribution, and this makes pip
# verify them rather than merely accept whatever the index serves for a pinned
# version. Without it the hashes in the file are decoration.
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

# Copy application code
COPY backend/app ./app
COPY backend/migrations ./migrations
COPY backend/scripts ./scripts
COPY backend/run.py .

# Every published image is a self-contained Apache-2.0 distribution.
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md /licenses/

# Create data directory for SQLite database and set up non-root user
RUN mkdir -p /app/data \
    && adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app

USER appuser

# Expose port
EXPOSE 8000

# Run the application
CMD ["python", "run.py"]
