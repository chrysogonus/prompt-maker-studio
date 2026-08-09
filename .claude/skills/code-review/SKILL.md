---
name: code-review
description: 'Perform a structured code review. Use when: reviewing a file, PR, function, or module for quality, security, and correctness. Covers Python, JavaScript, TypeScript, Docker, clean code principles, and OWASP security. Triggers: "review this code", "code review", "check my code", "review for security", "clean code check".'
argument-hint: 'Optional: file path or area to focus on (e.g., "backend/tools.py" or "security only")'
---

# Code Review Skill

## Purpose

Produce a structured, actionable code review covering correctness, clean code principles, language-specific best practices, and security. Flag issues by severity. Suggest concrete fixes.

## When to Use

- Reviewing a file, function, class, or module before merging
- Checking code for security vulnerabilities
- Evaluating code quality against clean code standards
- Reviewing Python, JavaScript, TypeScript, or Docker files

## Procedure

### 1. Gather Context

- Identify the file(s) or scope being reviewed (from the argument or the file(s) or scope named in the request).
- Read the full file(s). For large files, read the most critical sections first (entry points, public APIs, auth, data handling).
- Check for existing tests and their coverage of the reviewed code.

### 2. Apply Review Checklists

Load and apply each relevant checklist from the references below based on the file types in scope:

- **Clean Code** — applies to all files: [references/clean-code.md](./references/clean-code.md)
- **Python** — for `.py` files: [references/python.md](./references/python.md)
- **JavaScript / TypeScript** — for `.js`, `.ts`, `.jsx`, `.tsx` files: [references/javascript-typescript.md](./references/javascript-typescript.md)
- **Docker** — for `Dockerfile`, `docker-compose.yml`: [references/docker.md](./references/docker.md)
- **Security** — applies to all files, mandatory: [references/security.md](./references/security.md)

### 3. Classify Findings

Label each finding with a severity:

| Severity | Meaning |
|----------|---------|
| 🔴 Critical | Security vulnerability or data-loss risk. Must fix before merge. |
| 🟠 Major | Bug, logic error, or significant quality issue. Should fix. |
| 🟡 Minor | Style, naming, or minor clarity issue. Recommended. |
| 🔵 Suggestion | Optional improvement. Consider if time allows. |

### 4. Write the Review

Structure the output as:

```
## Code Review: <filename or scope>

### Summary
<1-3 sentence overall assessment>

### Findings

#### 🔴 Critical
- [Line X] <issue> — <suggested fix>

#### 🟠 Major
- [Line X] <issue> — <suggested fix>

#### 🟡 Minor
- [Line X] <issue> — <suggested fix>

#### 🔵 Suggestions
- [Line X] <optional improvement>

### What's Done Well
<brief note on strengths — omit if nothing noteworthy>
```

### 5. Offer to Apply Fixes

After presenting findings, ask:
> "Would you like me to apply any of these fixes?"

If yes, apply fixes surgically — change only the flagged lines, preserve surrounding code.

## Quality Gates

A review is complete when:
- [ ] All checklist sections from relevant references have been applied
- [ ] Every 🔴 Critical finding has a concrete fix suggestion
- [ ] Findings reference specific line numbers
- [ ] The summary reflects the overall risk level
