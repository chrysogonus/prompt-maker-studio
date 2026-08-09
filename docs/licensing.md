# Licensing and distributed artifacts

Prompt Maker Studio source code is licensed under Apache-2.0. The complete
project license is in [`LICENSE`](../LICENSE), the project attribution notice
is in [`NOTICE`](../NOTICE), and the runtime dependency inventories are in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## What is distributed

The Git repository is a source distribution and does not vendor installed
PyPI or npm packages. CI also publishes two binary container distributions:

- `prompt-maker-studio-backend`, based on `python:3.12-slim`
- `prompt-maker-studio-frontend`, based on `node:22-alpine`

Each final image contains the project `LICENSE`, `NOTICE`, and
`THIRD_PARTY_NOTICES.md` under `/licenses`. Package-specific license files
installed by pip or npm remain alongside their packages.

## Frontend optional dependencies

Next.js declares `sharp` as an optional dependency for image optimization.
This application does not use `next/image`, so the final frontend image runs
`npm ci --omit=dev --omit=optional`. The builder stage may contain optional
build dependencies, but that stage is discarded and is not a published
artifact.

This design keeps the `@img/sharp-libvips-*` native bundle and its LGPL
components out of the distributed runtime image. Both local CI and GitHub
Actions inspect the final image and fail when a `sharp-libvips` path is found.
If image optimization is introduced later, this decision must be revisited
before `sharp` is allowed into the runtime image.

## Dependency changes

When a lockfile changes:

1. Regenerate the backend locks with `make lock`.
2. Run `make check-locks`.
3. Rebuild both final images.
4. Re-inventory the final runtime dependencies and update
   `THIRD_PARTY_NOTICES.md`.
5. Verify all project and package license files remain available.
6. Obtain legal advice before distributing a newly introduced copyleft
   dependency.

This document records release-engineering controls and is not legal advice.
