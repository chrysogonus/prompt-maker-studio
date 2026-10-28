# frontend/ — agent operating notes

Next.js 16 (App Router), React 18, TypeScript 6. CSS Modules co-located with components (`Component.tsx` + `Component.module.css`). Tests co-located in `__tests__/` subfolders using Vitest + Testing Library + jsdom.

No Prettier — ESLint 9 flat config (`eslint-config-next/core-web-vitals`, see `frontend/eslint.config.mjs`) provides the lint rules. Run `make lint-frontend` (runs `tsc --noEmit` then ESLint).

Inner loop: `npm test` in `frontend/`. `make test-frontend` wraps `npm ci && npm run test:coverage` — slower,
but it's the gate that matches CI. Coverage floors live in `vitest.config.ts`.
`make lint-frontend` also checks `e2e/` and `playwright.config.ts`; `npm run lint` checks only `src/`.

API calls to the backend go through `frontend/src/lib/api.ts` — extend that rather than calling `fetch` ad hoc from components. The exceptions are `src/lib/auth.ts` (session and account endpoints) and `LegalLinks`, which reads the frontend's own `/legal.json`.

Feature UI, controllers and tests live under `src/features/{editor,library,settings,auth,evaluation,gallery,tools}/`.
App Router pages stay thin; shared design primitives and the authenticated shell live
under `src/components/`. Preserve presentation and browser storage keys during refactors.

`src/lib/api.ts` is the stable `ApiClient` facade; domain methods live in `src/lib/api/`.
Its transport preserves explicit session-renewal opt-ins and rebuilds CSRF headers
on retries. Keep password/auth failures distinguishable from session expiry.

`LibraryDataProvider` belongs inside the authenticated shell and is keyed by account.
Use it for shared library loading/invalidation; keep pending undo mutations local
until they commit. Never use a global cache for account data.

`src/app/layout.tsx` applies the stored theme before first paint on every route.
Light is the app default; with no stored choice, public pages (`isPublicPath` in `src/lib/theme.ts`)
follow the system. Preserve the unnamespaced `theme` key and explicit light/dark choices.
The JWT stays in an HttpOnly cookie; browser storage contains session-expiry hints,
preferences, and account-scoped drafts. Preserve draft recovery on session expiry
and content cleanup on explicit sign-out.
