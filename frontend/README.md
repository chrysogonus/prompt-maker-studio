# Prompt Maker Studio Frontend

The frontend is a Next.js 16 App Router application using React 18,
TypeScript 6, CSS Modules, Vitest, Testing Library, and Playwright.

Use the [root README](../README.md) for the product overview. This document is
a code map for frontend contributors.

## Routes and User Flows

The `(app)` route group supplies the authenticated shell, navigation, session
revalidation, theme/density initialization, and shared error states.

| Route | Responsibility |
|---|---|
| `/` | Dashboard analytics, spend, usage, and favorite prompts |
| `/dashboard` | Compatibility redirect to `/` |
| `/library` | Saved-prompt grid/list, filters, history, and prompt actions |
| `/editor/new` | Field-based composition, starter kits, AI import, generation, and first save |
| `/editor/[id]` | Prompt configuration, versions, preflight, evaluation, and AI refinement |
| `/playground/[id]` | Variable-aware execution, output metrics, and run history |
| `/settings` | Profile, preferences, notifications, export, and account deletion |
| `/reset-password` | Public password-reset completion flow |

The implemented behavior behind these routes is maintained in
[`product/FEATURES.md`](../product/FEATURES.md), not duplicated here.

## Code Organization

```text
frontend/
├── e2e/                   # Playwright browser journeys
├── src/
│   ├── app/               # Routes, layouts, global errors, and global styles
│   ├── components/
│   │   ├── editor/        # Configuration, evaluation, and refinement tabs
│   │   └── ui/            # Reusable design-system primitives
│   ├── lib/               # API/auth clients and pure prompt utilities
│   └── types/             # Shared frontend domain and API shapes
├── playwright.config.ts
├── vitest.config.ts
└── package.json
```

Feature components orchestrate page behavior; reusable controls belong in
`src/components/ui/`. Tests are co-located in `__tests__/` directories, while
cross-stack browser tests live in `e2e/`.

## Data, Authentication, and State

- Backend requests go through `src/lib/api.ts`; do not add component-local
  `fetch` calls.
- Authentication, JWT persistence, sliding renewal, and session-expiry state
  go through `src/lib/auth.ts`.
- API and UI shapes live under `src/types/`; keep them aligned with backend
  Pydantic schemas when contracts change.
- Saved prompts, versions, runs, eval cases, and preferences are server state.
  Local storage is limited to UI preferences and recoverable in-progress
  drafts.
- Backend calls are same-origin `/api/...` paths built on `src/lib/apiBase.ts`.
  Nothing about the API's location is compiled into the bundle, which is what
  lets one published image serve any domain — see the comment in that file
  before reintroducing any `NEXT_PUBLIC_*` URL.

## Styling and Accessibility

CSS Modules stay beside their components. Global tokens, themes, density, and
base accessibility behavior live in `src/app/globals.css`. Reuse the existing
UI primitives and semantic status/error patterns before introducing new
controls.

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

`make test-e2e` starts an isolated Compose project on dedicated ports and runs
the Chromium suite against real frontend and backend containers.
