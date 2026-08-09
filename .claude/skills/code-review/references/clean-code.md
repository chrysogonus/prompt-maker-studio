# Clean Code Checklist
Applies to all languages. When a rule conflicts with the codebase's established conventions, flag it for discussion rather than enforcing it automatically.

## Naming
- [ ] Names reveal intent — a reader should understand purpose without reading the implementation.
- [ ] No abbreviations, acronyms, or single-letter names outside of well-understood conventions (`i` in a short loop, `e` in an except clause).
- [ ] Boolean variables and functions use a predicate form: `is_valid`, `has_permission`, `can_retry`.
- [ ] Functions named as verbs or verb phrases (`calculate_total`, `fetch_user`), not nouns.
- [ ] Classes named as nouns, not verbs.
- [ ] No misleading names (e.g., a variable named `data` that holds a list of users should be `users`).
- [ ] Constants are `UPPER_SNAKE_CASE` where the language convention supports it.

## Functions
- [ ] Each function does one thing (Single Responsibility). If you need "and" to describe what it does, split it.
- [ ] Functions are short — ideally under 20 lines. If longer, each section has a clear, distinct role.
- [ ] No more than 3–4 parameters. Use a data class, dict, or config object for more.
- [ ] No flag arguments (boolean parameters that change a function's behavior). Prefer two explicitly named functions. Exception: a simple `enabled=True/False` toggle on a trivial utility is acceptable.
- [ ] No side effects beyond what the name implies. A getter shouldn't write state.
- [ ] Prefer separation of commands (do something) and queries (return something). When a function must do both, the dual role is intentional and documented.

## Control Flow
- [ ] Guard clauses and early returns are preferred over deep nesting.
- [ ] Nesting depth is at most 2–3 levels. Deeply nested code is extracted into named functions.
- [ ] No `else` after a `return` — it's redundant and adds visual nesting.
- [ ] Ternary expressions are used only for simple, readable conditions — not chained ternaries.
- [ ] Magic numbers and strings are extracted into named constants, including those used in conditions (e.g., `if count > MAX_RETRIES` not `if count > 3`).

## Comments
- [ ] Code explains itself where possible — no comments that restate what the code does.
- [ ] Comments explain *why*, not *what*: business rules, non-obvious constraints, workarounds.
- [ ] No commented-out code left in the file. Use version control instead.
- [ ] TODO/FIXME comments include a ticket number or a date — not left open-ended.

## Types and Contracts
- [ ] Public functions and methods are annotated with types or signatures where the language supports it (type hints, JSDoc, etc.).
- [ ] Return types are explicit — callers shouldn't have to read the implementation to know what they'll get.
- [ ] Functions that can fail return meaningful errors or raise typed exceptions — not `None` or `null` with no explanation.

## Data and State
- [ ] Variables are defined close to where they are used, not declared at the top of a function.
- [ ] Mutable state is minimized. Prefer immutable values where practical.
- [ ] No global mutable state unless absolutely necessary and clearly documented.
- [ ] Data structures reflect the domain — use typed objects or dataclasses rather than generic dicts or maps when the shape is fixed and known.

## Error Handling
- [ ] Errors are handled at the right level — not swallowed silently, not caught too broadly.
- [ ] Error messages are actionable: they tell the caller what went wrong and, where possible, how to fix it.
- [ ] No bare `except: pass` or equivalent. At minimum, log the error with context.
- [ ] Exceptions are used for exceptional cases, not as control flow.

## DRY and Cohesion
- [ ] No duplicated logic — shared logic is extracted into a named function or helper.
- [ ] No copy-paste code with minor variations — parameterize the difference.
- [ ] Related code is grouped together. Unrelated code is separated.

## Testing
- [ ] Non-trivial logic has tests. Untested code is noted and justified.
- [ ] Test names describe observable behavior, not implementation details (`test_returns_empty_list_when_no_users_found`, not `test_fetch_users_line_42`).
- [ ] Tests cover the happy path, expected edge cases, and key failure modes — not just that the function runs.
- [ ] No tests that assert trivially true things (e.g., `assert result is not None` with no further checks).
- [ ] Test setup is minimal and clear — a reader should understand the scenario without digging through fixtures.

## File and Module Structure
- [ ] Each file or module has a clear single responsibility.
- [ ] No "utility" or "helpers" dumping ground — utilities are organized by domain.
- [ ] The public API of a module is minimal and intentional — private details are not exported unnecessarily.
- [ ] Dependencies flow in one direction. Modules don't reach across unrelated domains.
- [ ] Imports are ordered and unused imports are removed.