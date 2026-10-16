# Prompt Maker Studio Frontend

The frontend is a Next.js 16 App Router application using React 18,
TypeScript 6, CSS Modules, Vitest, Testing Library, and Playwright.

Use the [root README](../README.md) for the product overview. This document is
a code map for frontend contributors.

## Routes and User Flows

The `(app)` route group supplies the authenticated sidebar shell (a drawer on
phones), session revalidation, and shared error states. The root layout applies
the saved theme before first paint on both public and authenticated pages.

| Route | Responsibility |
|---|---|
| `/` | Public landing page; visitors with an `access_token` cookie redirect to `/library` |
| `/library` | The library: all prompts, favorites, a folder, or unfiled (`?view=`, `?folder=`), with search, list/grid, and prompt and folder actions |
| `/editor/new` | The sections editor for a new prompt; `?starter=` and `?import=1` start from a template or Paste a prompt |
| `/editor/[id]` | The same editor for a saved prompt: preview, fill and copy, versions, rename and move |
| `/editor/[id]/evaluate` | Saved test cases, CSV import/export, AI suggestions, evaluation runs, manual ratings, and run comparison |
| `/settings` | Profile, password and sessions, theme, library layout, AI connection, export, and account deletion |
| `/dashboard`, `/playground/[id]` | Compatibility redirects for retired screens |
| `/guides` | Public index of practical prompt guides |
| `/guides/reusable-ai-prompts`, `/guides/prompt-template-variables`, `/guides/organize-chatgpt-prompts` | Public articles with examples and links into the app |
| `/impressum`, `/datenschutz`, `/legal.json` | Deployment-configured public legal pages and their configuration endpoint |
| `/reset-password` | Public password-reset completion flow |
| `/oauth/authorize` | Consent page for linking an MCP client such as ChatGPT |

The implemented behavior behind these routes is maintained in
[`product/FEATURES.md`](../product/FEATURES.md), not duplicated here.

## Code Organization

```text
frontend/
├── e2e/                   # Playwright browser journeys
├── src/
│   ├── app/               # Routes, layouts, global errors, and global styles
│   ├── components/
│   │   ├── brand/         # Shared product mark
│   │   ├── guides/        # Public guide layouts and article links
│   │   ├── shell/         # The sidebar
│   │   └── ui/            # Reusable design-system primitives
│   ├── features/
│   │   ├── auth/          # Sign-in, registration, password, and session handling
│   │   ├── editor/        # Sections, preview, import, refinement, history, and drafts
│   │   ├── evaluation/    # Test cases, runs, scores, and comparisons
│   │   ├── library/       # Library UI, controller, and account-scoped provider
│   │   └── settings/      # Profile, preferences, AI connection, export, and deletion
│   ├── lib/               # ApiClient facade, domain API modules, auth, and utilities
│   └── types/             # Shared frontend domain and API shapes
├── playwright.config.ts
├── vitest.config.ts
└── package.json
```

App Router pages stay thin; feature components and hooks orchestrate page
behavior. Reusable controls belong in `src/components/ui/`. Tests are co-located
in `__tests__/` directories, while cross-stack browser tests live in `e2e/`.

## Data, Authentication, and State

- Backend requests go through `src/lib/api.ts`; do not add component-local
  `fetch` calls.
- Authentication goes through `src/lib/auth.ts`; the JWT is an HttpOnly cookie,
  with only a session-expiry hint stored in local storage.
  `src/features/auth/useSession.ts` handles activity-based renewal, expiry
  warnings, and sign-in recovery. Network failures preserve the saved session.
- `src/lib/api/` holds domain methods behind the `ApiClient` facade. Its transport
  distinguishes plain session requests from callers that opt into renewal, and
  rebuilds CSRF headers after a refresh before retrying once.
- `LibraryDataProvider` shares library state inside the authenticated shell and
  remounts for each account. Pending undo operations stay local until committed.
- API and UI shapes live under `src/types/`; keep them aligned with backend
  Pydantic schemas when contracts change.
- Prompts, versions, folders, and preferences are server state. The editor
  saves section fields and variable metadata; `src/lib/sections.ts` mirrors the
  server's rendering for the preview. Local storage holds the theme and
  account-scoped recoverable drafts, including pending imports and preserved
  imported inputs. Explicit sign-out clears stored user content; involuntary
  expiry preserves it for recovery.
- Backend calls default to same-origin `/api/...` paths built on
  `src/lib/apiBase.ts`. Caddy proxies production traffic; Next.js rewrites use
  the runtime `API_PROXY_TARGET` elsewhere. The optional `NEXT_PUBLIC_API_URL`
  override is compiled into the client for local cross-origin development and
  must stay unset when building a domain-independent published image.
- Public canonical URLs and social metadata use runtime `FRONTEND_URL` via
  `src/lib/branding.ts`; guides, sitemap, and robots routes share it.

## Styling and Accessibility

CSS Modules stay beside their components. Global tokens, themes, and
base accessibility behavior live in `src/app/globals.css`; fonts and the
pre-paint theme script live in `src/app/layout.tsx`. Light is the default;
Settings persists the explicit light/dark choice under the `theme` key.
Reuse the existing UI primitives and semantic status/error patterns before
introducing new controls.

Frontend-specific agent conventions are in [`AGENTS.md`](AGENTS.md). The
overall development setup is in
[`docs/development.md`](../docs/development.md).

## Development and Verification

Run routine commands from the repository root:

```bash
make dev-frontend
make lint-frontend
make test-frontend
make build-frontend
make setup-e2e
make test-e2e
```

For focused work inside `frontend/`:

```bash
npm run dev
npm run test:watch
npm run build
```

`make lint-frontend` installs locked dependencies and checks TypeScript, then
ESLint across `src/`, `e2e/`, and `playwright.config.ts`.
`make test-frontend` installs locked dependencies and runs Vitest with coverage;
the thresholds are defined in `vitest.config.ts`. `npm test` is the faster unit
test loop without coverage.

`make test-e2e` starts an isolated Compose project on dedicated ports and runs
the Chromium suite against real frontend and backend containers.

Ordinary Playwright runs exclude `e2e/screenshots.spec.ts`. Use the separate
`make screenshots` target to refresh the six standard views in `docs/assets/`:
sign-in, library, editor, history, new prompt and phone. The README feature
illustrations (`prompt-management.png`, `refinement.png`, `evaluation.png`) are
curated browser captures of those workflows, with synthetic AI outputs/scores;
the target does not regenerate them. Landing images are packaged separately
under `public/landing/`.
