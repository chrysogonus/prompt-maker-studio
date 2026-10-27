# Third-party software notices

Prompt Maker Studio is licensed under Apache-2.0. Its published container
images also contain the runtime dependencies listed below. Versions reflect
`backend/requirements.lock` and the production, non-optional install of
`frontend/package-lock.json`, checked against the built images;
package-specific license and notice files installed by pip and npm remain
alongside the corresponding packages in each image.

Development and test dependencies are not included in the published images.
The images also contain their official `python:3.12-slim` or `node:22-alpine`
base-image components, whose package metadata and license files remain in the
base filesystem. Both base images are pinned by digest in the Dockerfiles.
The builds also install or upgrade OS packages from their distribution
repositories, so a pinned base does not make the entire final image reproducible
byte for byte; inspect the built artifact when updating its inventory.

## Backend image

| Package | Version | License |
|---|---:|---|
| annotated-doc | 0.0.4 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.14.2 | MIT |
| attrs | 26.1.0 | MIT |
| bcrypt | 5.0.0 | Apache-2.0 |
| certifi | 2026.10.19 | MPL-2.0 |
| cffi | 2.1.0 | MIT-0 |
| click | 8.4.2 | BSD-3-Clause |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause |
| Deprecated | 1.3.1 | MIT |
| dnspython | 2.8.0 | ISC |
| email-validator | 2.3.0 | Unlicense |
| fastapi | 0.146.0 | MIT |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpcore2 | 2.14.0 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| httpx2 | 2.14.0 | BSD-3-Clause |
| idna | 3.18 | BSD-3-Clause |
| jiter | 0.16.0 | MIT |
| jsonschema | 4.26.0 | MIT |
| jsonschema-specifications | 2025.9.1 | MIT |
| limits | 5.8.0 | MIT |
| mcp | 2.3.0 | MIT |
| mcp-types | 2.3.0 | MIT |
| msgpack | 1.2.3 | Apache-2.0 |
| openai | 3.35.1 | Apache-2.0 |
| opentelemetry-api | 1.45.1 | Apache-2.0 |
| packaging | 26.2 | Apache-2.0 OR BSD-2-Clause |
| prometheus-fastapi-instrumentator | 8.1.0 | ISC |
| prometheus_client | 0.26.0 | Apache-2.0 AND BSD-2-Clause |
| pycparser | 3.0 | BSD-3-Clause |
| pydantic | 2.14.1 | MIT |
| pydantic_core | 2.50.1 | MIT |
| PyJWT | 2.15.1 | MIT |
| python-multipart | 0.0.32 | Apache-2.0 |
| referencing | 0.37.0 | MIT |
| rpds-py | 2026.9.1 | MIT |
| slowapi | 0.1.10 | MIT |
| sniffio | 1.3.1 | MIT OR Apache-2.0 |
| SQLAlchemy | 2.1.5 | MIT |
| sse-starlette | 3.5.0 | BSD-3-Clause |
| starlette | 1.9.0 | BSD-3-Clause |
| truststore | 0.10.4 | MIT |
| typing-inspection | 0.4.4 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| uvicorn | 0.54.0 | BSD-3-Clause |
| wrapt | 2.2.2 | BSD-2-Clause |

The MPL-covered `certifi` files are shipped unmodified. Their source and license
information are available from [certifi](https://github.com/certifi/python-certifi).

## Frontend image

The final image is installed with `npm ci --omit=dev --omit=optional`.

| Package | Version | License |
|---|---:|---|
| @next/env | 16.4.1 | MIT |
| @swc/helpers | 0.5.23 | Apache-2.0 |
| @types/debug | 4.1.13 | MIT |
| @types/estree | 1.0.9 | MIT |
| @types/estree-jsx | 1.0.5 | MIT |
| @types/hast | 3.0.5 | MIT |
| @types/mdast | 4.0.4 | MIT |
| @types/ms | 2.1.0 | MIT |
| @types/prop-types | 15.7.15 | MIT |
| @types/react | 18.3.27 | MIT |
| @types/unist | 3.0.3 | MIT |
| @ungap/structured-clone | 1.4.0 | ISC |
| bail | 2.0.2 | MIT |
| baseline-browser-mapping | 2.11.27 | Apache-2.0 |
| caniuse-lite | 1.0.30001814 | CC-BY-4.0 |
| ccount | 2.0.1 | MIT |
| character-entities | 2.0.2 | MIT |
| character-entities-html4 | 2.1.0 | MIT |
| character-entities-legacy | 3.0.0 | MIT |
| character-reference-invalid | 2.0.1 | MIT |
| client-only | 0.0.1 | MIT |
| comma-separated-tokens | 2.0.3 | MIT |
| csstype | 3.2.3 | MIT |
| debug | 4.4.3 | MIT |
| decode-named-character-reference | 1.3.0 | MIT |
| dequal | 2.0.3 | MIT |
| devlop | 1.1.0 | MIT |
| estree-util-is-identifier-name | 3.0.0 | MIT |
| extend | 3.0.2 | MIT |
| hast-util-to-jsx-runtime | 2.3.6 | MIT |
| hast-util-whitespace | 3.0.0 | MIT |
| html-url-attributes | 3.0.1 | MIT |
| inline-style-parser | 0.2.7 | MIT |
| is-alphabetical | 2.0.1 | MIT |
| is-alphanumerical | 2.0.1 | MIT |
| is-decimal | 2.0.1 | MIT |
| is-hexadecimal | 2.0.1 | MIT |
| is-plain-obj | 4.1.0 | MIT |
| js-tokens | 4.0.0 | MIT |
| longest-streak | 3.1.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| lucide-react | 1.57.0 | ISC |
| markdown-table | 3.0.4 | MIT |
| mdast-util-find-and-replace | 3.0.4 | MIT |
| mdast-util-from-markdown | 2.1.0 | MIT |
| mdast-util-gfm | 3.1.0 | MIT |
| mdast-util-gfm-autolink-literal | 2.0.1 | MIT |
| mdast-util-gfm-footnote | 2.1.0 | MIT |
| mdast-util-gfm-strikethrough | 2.0.1 | MIT |
| mdast-util-gfm-table | 2.0.0 | MIT |
| mdast-util-gfm-task-list-item | 2.0.0 | MIT |
| mdast-util-mdx-expression | 2.0.1 | MIT |
| mdast-util-mdx-jsx | 3.2.0 | MIT |
| mdast-util-mdxjs-esm | 2.0.1 | MIT |
| mdast-util-phrasing | 4.1.0 | MIT |
| mdast-util-to-hast | 13.2.1 | MIT |
| mdast-util-to-markdown | 2.2.0 | MIT |
| mdast-util-to-string | 4.0.0 | MIT |
| micromark | 4.0.3 | MIT |
| micromark-core-commonmark | 2.0.4 | MIT |
| micromark-extension-gfm | 3.0.0 | MIT |
| micromark-extension-gfm-autolink-literal | 2.1.0 | MIT |
| micromark-extension-gfm-footnote | 2.1.0 | MIT |
| micromark-extension-gfm-strikethrough | 2.1.0 | MIT |
| micromark-extension-gfm-table | 2.1.2 | MIT |
| micromark-extension-gfm-tagfilter | 2.0.0 | MIT |
| micromark-extension-gfm-task-list-item | 2.1.0 | MIT |
| micromark-factory-destination | 2.0.1 | MIT |
| micromark-factory-label | 2.0.1 | MIT |
| micromark-factory-space | 2.1.0 | MIT |
| micromark-factory-title | 2.0.1 | MIT |
| micromark-factory-whitespace | 2.0.1 | MIT |
| micromark-util-character | 2.1.1 | MIT |
| micromark-util-chunked | 2.0.1 | MIT |
| micromark-util-classify-character | 2.0.1 | MIT |
| micromark-util-combine-extensions | 2.0.1 | MIT |
| micromark-util-decode-numeric-character-reference | 2.0.2 | MIT |
| micromark-util-decode-string | 2.0.1 | MIT |
| micromark-util-edit-map | 1.0.0 | MIT |
| micromark-util-encode | 2.0.1 | MIT |
| micromark-util-html-tag-name | 2.0.1 | MIT |
| micromark-util-normalize-identifier | 2.0.1 | MIT |
| micromark-util-resolve-all | 2.0.1 | MIT |
| micromark-util-sanitize-uri | 2.0.1 | MIT |
| micromark-util-subtokenize | 2.1.0 | MIT |
| micromark-util-symbol | 2.0.1 | MIT |
| micromark-util-types | 2.0.3 | MIT |
| ms | 2.1.3 | MIT |
| nanoid | 3.3.18 | MIT |
| next | 16.4.1 | MIT |
| parse-entities | 4.0.2 | MIT |
| picocolors | 1.1.1 | ISC |
| postcss | 8.5.23 | MIT |
| property-information | 7.2.0 | MIT |
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| react-markdown | 10.1.0 | MIT |
| remark-gfm | 4.0.1 | MIT |
| remark-parse | 11.0.0 | MIT |
| remark-rehype | 11.1.2 | MIT |
| remark-stringify | 11.0.0 | MIT |
| scheduler | 0.23.2 | MIT |
| source-map-js | 1.2.2 | BSD-3-Clause |
| space-separated-tokens | 2.0.2 | MIT |
| stringify-entities | 4.0.4 | MIT |
| style-to-js | 1.1.21 | MIT |
| style-to-object | 1.0.14 | MIT |
| styled-jsx | 5.1.6 | MIT |
| trim-lines | 3.0.1 | MIT |
| trough | 2.2.0 | MIT |
| tslib | 2.8.1 | 0BSD |
| unified | 11.0.5 | MIT |
| unist-util-is | 6.0.1 | MIT |
| unist-util-position | 5.0.0 | MIT |
| unist-util-stringify-position | 4.0.0 | MIT |
| unist-util-visit | 5.2.0 | MIT |
| unist-util-visit-parents | 6.1.0 | MIT |
| vfile | 6.0.3 | MIT |
| vfile-message | 4.0.3 | MIT |
| zwitch | 2.0.4 | MIT |

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
5. Run `make check-notices` to compare the documented package names and versions
   with both built `:test` images, and confirm the frontend image still contains
   no `sharp-libvips` path.

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
