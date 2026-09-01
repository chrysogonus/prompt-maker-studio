# Pinned by digest — see backend/Dockerfile for the rationale.
FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS builder

WORKDIR /app

# Next.js collects anonymous telemetry by default and prints a notice mid-build.
# A self-hoster building this image has not agreed to that; make it an explicit
# opt-in rather than something they discover in build output.
ENV NEXT_TELEMETRY_DISABLED=1

# Copy package files and install ALL dependencies (needed for build)
COPY frontend/package*.json ./
RUN npm ci

# Copy application code
COPY frontend/. .

# No NEXT_PUBLIC_API_URL build argument, deliberately. A NEXT_PUBLIC_* value is
# compiled into the client bundle and cannot be changed when the container
# starts, so baking one here would hard-code a single deployment's API domain
# into every published image. The browser calls /api on its own origin instead
# (src/lib/apiBase.ts); set API_PROXY_TARGET at runtime to point the Next
# server's /api rewrite somewhere other than http://backend:8000.

# Build the application
RUN npm run build

# Production dependencies, resolved in a stage that is thrown away. The
# application does not use next/image, so omitting optional packages keeps
# Next's sharp/libvips native bundle (and its LGPL components) out of the
# published image.
FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS deps

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --omit=dev --omit=optional

# Production image
FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# The package manager is deliberately removed from the runtime image. npm
# bundles its own dependency tree (tar, sigstore, brace-expansion, ip-address,
# picomatch, ...), and those — not this application's code — were every
# HIGH/CRITICAL finding a vulnerability scan reported against this image.
# Nothing installs anything at runtime, so npm has no reason to be here.
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/package*.json ./

# Every published image is a self-contained Apache-2.0 distribution.
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md /licenses/

# Set up non-root user
RUN adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app

USER appuser

# Expose port
EXPOSE 3000

# `next start` directly rather than `npm start` — there is no npm here now.
CMD ["node_modules/.bin/next", "start"]
