# JavaScript / TypeScript Review Checklist

## Language Baseline

- [ ] `const` by default; `let` only when reassignment is necessary; `var` never.
- [ ] Arrow functions used for callbacks and short expressions; named functions for methods and top-level definitions.
- [ ] Template literals instead of string concatenation.
- [ ] Destructuring used for extracting values from objects/arrays where it improves clarity.
- [ ] Optional chaining (`?.`) and nullish coalescing (`??`) used where appropriate.
- [ ] `===` and `!==` always — never `==` or `!=`.
- [ ] No `eval()`, `new Function()`, or `setTimeout(string, ...)`.
- [ ] No `console.log` left in production code (debug artifacts).

## Async and Promises

- [ ] `async/await` preferred over raw `.then()/.catch()` chains for readability.
- [ ] `await` used inside `try/catch` — unhandled promise rejections are a runtime error.
- [ ] No `await` in a loop when operations are independent — use `Promise.all()` instead.
- [ ] Async functions always return a meaningful value or `void` — no implicit `undefined` with side effects.
- [ ] Error objects are thrown, not strings: `throw new Error("message")` not `throw "message"`.

## TypeScript Specifics

- [ ] `strict: true` (or at minimum `noImplicitAny`, `strictNullChecks`) enabled in `tsconfig.json`.
- [ ] No `any` — use `unknown` and narrow the type, or define an interface.
- [ ] Interfaces for external/public API shapes; types for unions, intersections, and aliases.
- [ ] `as X` type assertions avoided except when narrowing is impossible; never `as any`.
- [ ] Return types annotated on all public/exported functions.
- [ ] `readonly` used on properties that should not be mutated after construction.
- [ ] Enum alternatives (const objects with `as const`) preferred over TypeScript enums for plain value sets.
- [ ] Generic types named meaningfully (`TEntity` not just `T`) for complex generics.

## React (if applicable)

- [ ] Components are functional — no class components unless the codebase already uses them.
- [ ] Props are typed with an interface or type alias.
- [ ] `useEffect` dependencies are complete and correct — no missing deps, no unnecessary deps.
- [ ] No inline object/array creation in JSX props (creates new references every render).
- [ ] `key` prop in lists is stable and unique — never the array index if the list can be reordered or filtered.
- [ ] Side effects are isolated in `useEffect`, not during render.

## Modules and Imports

- [ ] No circular imports.
- [ ] Barrel files (`index.ts`) used sparingly — they complicate tree-shaking and can cause circular dependency issues.
- [ ] Third-party imports are not aliased in a way that hides their origin.
- [ ] Dynamic `import()` used only for code-splitting, not to avoid type errors.

## Error Handling

- [ ] `try/catch` in async functions always handles or re-throws. No silent swallowing.
- [ ] Error boundaries (React) or global error handlers cover uncaught errors in UI code.
- [ ] User-facing error messages are generic — internal details are logged, not displayed.

## Performance

- [ ] No unnecessary re-renders triggered by unstable references in dependencies.
- [ ] Large data transforms happen outside the render cycle.
- [ ] DOM manipulation is minimal — avoid `document.querySelector` in modern framework code.

## Testing

- [ ] Tests follow Arrange-Act-Assert.
- [ ] Mocks are reset between tests to prevent cross-test contamination.
- [ ] Async tests `await` correctly — no unawaited assertions that pass trivially.
- [ ] Edge cases: null/undefined inputs, empty arrays, network failure paths.
