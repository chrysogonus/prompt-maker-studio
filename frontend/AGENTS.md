# frontend/ — agent operating notes

Next.js 16 (App Router), React 18, TypeScript 6. CSS Modules co-located with components (`Component.tsx` + `Component.module.css`). Tests co-located in `__tests__/` subfolders using Vitest + Testing Library + jsdom.

No Prettier — ESLint 9 flat config (`eslint-config-next/core-web-vitals`, see `frontend/eslint.config.mjs`) is the only formatter/linter. Run `make lint-frontend` (runs `tsc --noEmit` then ESLint).

Inner loop: `npm test` in `frontend/`. `make test-frontend` wraps `npm ci && npm test` — slower,
but it's the gate that matches CI.

API calls to the backend go through `frontend/src/lib/api.ts` — extend that rather than calling `fetch` ad hoc from components.
