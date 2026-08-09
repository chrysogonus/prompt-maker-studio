# Third-party software notices

Prompt Maker Studio is licensed under Apache-2.0. Its published container
images also contain the runtime dependencies listed below. Versions are
generated from `backend/requirements.lock` and `frontend/package-lock.json`;
package-specific license and notice files installed by pip and npm remain
alongside the corresponding packages in each image.

Development and test dependencies are not included in the published images.
The images also contain their official `python:3.12-slim` or `node:22-alpine`
base-image components, whose package metadata and license files remain in the
base filesystem. Both base images are pinned by digest in the Dockerfiles, so
rebuilding a given commit retrieves the same bytes and this inventory stays
accurate for it.

## Backend image

| Package | Version | License |
|---|---:|---|
| annotated-doc | 0.0.4 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.14.2 | MIT |
| bcrypt | 5.0.0 | Apache-2.0 |
| certifi | 2026.7.22 | MPL-2.0 |
| cffi | 2.1.0 | MIT-0 |
| click | 8.4.2 | BSD-3-Clause |
| cryptography | 50.0.0 | Apache-2.0 OR BSD-3-Clause |
| Deprecated | 1.3.1 | MIT |
| distro | 1.9.0 | Apache-2.0 |
| dnspython | 2.8.0 | ISC |
| email-validator | 2.3.0 | Unlicense |
| fastapi | 0.140.0 | MIT |
| greenlet | 3.5.4 | MIT AND PSF-2.0 |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| idna | 3.18 | BSD-3-Clause |
| jiter | 0.16.0 | MIT |
| limits | 5.8.0 | MIT |
| msgpack | 1.2.1 | Apache-2.0 |
| openai | 2.48.0 | Apache-2.0 |
| packaging | 26.2 | Apache-2.0 OR BSD-2-Clause |
| prometheus-fastapi-instrumentator | 8.1.0 | ISC |
| prometheus_client | 0.26.0 | Apache-2.0 AND BSD-2-Clause |
| pycparser | 3.0 | BSD-3-Clause |
| pydantic | 2.13.4 | MIT |
| pydantic_core | 2.46.4 | MIT |
| PyJWT | 2.13.0 | MIT |
| slowapi | 0.1.9 | MIT |
| sniffio | 1.3.1 | MIT OR Apache-2.0 |
| SQLAlchemy | 2.0.51 | MIT |
| starlette | 1.3.1 | BSD-3-Clause |
| tqdm | 4.69.1 | MPL-2.0 AND MIT |
| typing-inspection | 0.4.2 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| uvicorn | 0.27.0 | BSD-3-Clause |
| wrapt | 2.2.2 | BSD-2-Clause |

The MPL-covered `certifi` and `tqdm` files are shipped unmodified. Their source
and license information are available from
[certifi](https://github.com/certifi/python-certifi) and
[tqdm](https://github.com/tqdm/tqdm).

## Frontend image

The final image is installed with `npm ci --omit=dev --omit=optional`.

| Package | Version | License |
|---|---:|---|
| @next/env | 16.2.11 | MIT |
| @swc/helpers | 0.5.15 | Apache-2.0 |
| baseline-browser-mapping | 2.10.40 | Apache-2.0 |
| caniuse-lite | 1.0.30001799 | CC-BY-4.0 |
| client-only | 0.0.1 | MIT |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| lucide-react | 1.28.0 | ISC |
| nanoid | 3.3.18 | MIT |
| next | 16.2.11 | MIT |
| picocolors | 1.1.1 | ISC |
| postcss | 8.5.23 | MIT |
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| scheduler | 0.23.2 | MIT |
| source-map-js | 1.2.1 | BSD-3-Clause |
| styled-jsx | 5.1.6 | MIT |
| tslib | 2.8.1 | 0BSD |

`lucide-react` is ISC licensed. Its icon set is derived from
[Feather](https://github.com/feathericons/feather), Copyright (c) 2013-2023
Cole Bemis, MIT licensed; both notices ship with the package inside the image.

Next.js declares `sharp` as an optional dependency. Prompt Maker Studio does
not use `next/image`, so optional dependencies are deliberately omitted from
the published runtime image. Consequently, the `@img/sharp-libvips-*` native
bundle and its LGPL-licensed libraries are not redistributed. CI inspects the
final image and fails if a `sharp-libvips` path is present.

## Repository source material

These files are distributed in the source repository but are not part of either
container image.

| Path | Origin | License |
|---|---|---|
| `.claude/skills/find-skills/SKILL.md` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | MIT |
| `CODE_OF_CONDUCT.md` | [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html) | CC-BY-4.0 |

`CODE_OF_CONDUCT.md` is adapted from the Contributor Covenant, version 2.1.
CC BY 4.0 requires attribution, which that file carries in its own Attribution
section; this row exists so the vendored inventory is complete rather than
listing only some of it.

The `find-skills` file is a **modified** copy of the upstream skill,
Copyright (c) 2026 Vercel, Inc. Its complete MIT license text is reproduced in
`.claude/skills/find-skills/NOTICE`, and the file itself carries a provenance
header. Everything else under `.claude/skills/` is original work of this
project, licensed under Apache-2.0 with the rest of the repository.

## External services

Users may connect OpenAI, Anthropic, Google Gemini, Ollama, vLLM, or another
OpenAI-compatible endpoint. Those services and models are governed by their
respective terms; they are not distributed with Prompt Maker Studio.

## Maintaining this file

Whenever either lockfile changes:

1. Regenerate backend locks with `make lock`.
2. Rebuild both final images.
3. Re-inventory licenses from the final images, including transitive packages.
4. Update this file in the same change.
5. Confirm the frontend image still contains no `sharp-libvips` path.

Inventory both images directly rather than reading the lockfiles — the frontend
table is the output of `npm ci --omit=dev --omit=optional` as it exists in the
image, which is what is actually redistributed:

```bash
docker run --rm --entrypoint sh prompt-maker-studio-backend:test -c 'pip list --format=freeze'
docker run --rm --entrypoint sh prompt-maker-studio-frontend:test -c \
  'find /app/node_modules -maxdepth 3 -name package.json'
```

This inventory is provided for attribution and release engineering. It is not
legal advice.
