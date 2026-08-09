# Product Owner Document Templates

Use these templates when creating files in the `product/` folder. Fill in all `[BRACKETED]` placeholders with information drawn from the actual codebase — never fabricate details.

---

## VISION.md

```markdown
# Product Vision

## One-liner
[One sentence describing what this product does and for whom.]

## Problem Statement
[What problem does this product solve? What pain points exist without it?]

## Target Users
| Persona | Description | Primary Need |
|---|---|---|
| [Persona 1] | [Brief description] | [What they need most] |
| [Persona 2] | [Brief description] | [What they need most] |

## Value Proposition
[What makes this product valuable? What would users lose if it didn't exist?]

## Success Metrics
- [Metric 1: e.g. "Users can create a structured prompt in under 60 seconds"]
- [Metric 2: e.g. "Prompt history reduces re-work"]
- [Metric 3]

## Non-Goals (Out of Scope)
- [What this product intentionally does NOT do]
- [Scope boundaries that help keep the product focused]

## Tech Stack Summary
- **Backend**: [e.g. FastAPI, Python 3.12, SQLite]
- **Frontend**: [e.g. Next.js, TypeScript]
- **Infrastructure**: [e.g. Docker, Caddy reverse proxy]
```

---

## FEATURES.md

```markdown
# Implemented Features

> Last updated: [DATE]
> Source of truth: codebase scan as of this date.

## Authentication & User Management
| Feature | Status | Description | Implemented in |
|---|---|---|---|
| [Feature name] | ✅ Implemented | [What it does] | `[path/to/file.py]` |

## Core Functionality
| Feature | Status | Description | Implemented in |
|---|---|---|---|
| [Feature name] | ✅ Implemented | [What it does] | `[path/to/file.py]` |

## Data & Persistence
| Feature | Status | Description | Implemented in |
|---|---|---|---|
| [Feature name] | ✅ Implemented | [What it does] | `[path/to/file.py]` |

## UI & User Experience
| Feature | Status | Description | Implemented in |
|---|---|---|---|
| [Feature name] | ✅ Implemented | [What it does] | `[path/to/file.tsx]` |

## Developer & Operations
| Feature | Status | Description | Implemented in |
|---|---|---|---|
| [Feature name] | ✅ Implemented | [What it does] | `[path/to/file]` |

## Feature Detail Notes
### [Feature Name]
- **What it does**: [Detailed description]
- **User benefit**: [Why this matters to the user]
- **Technical location**: `[path/to/implementation]`
- **Limitations / known gaps**: [Any caveats]
```

---

## ROADMAP.md

```markdown
# Product Roadmap

> Updated: [DATE]

## Now — Current Sprint / Active Development
- [ ] [Feature or fix actively being worked on]
- [ ] [...]

## Next — Coming Soon (next 1–2 sprints)
- [ ] [Planned feature with brief justification]
- [ ] [...]

## Later — Quarterly Horizon
- [ ] [Bigger initiative or theme]
- [ ] [...]

## Someday / Aspirational
- [ ] [Long-horizon ideas or moonshots]
- [ ] [...]

## Completed (moved from roadmap)
| Item | Completed | Notes |
|---|---|---|
| [Feature] | [Date/version] | [Any notes] |
```

---

## BACKLOG.md

```markdown
# Product Backlog

> Items here are NOT yet implemented. See FEATURES.md for what is built.
> Sorted by priority within each category.

## Priority: High
### [Feature Title]
- **Problem it solves**: [User/business need]
- **Proposed solution**: [High-level approach]
- **Effort**: Low / Medium / High
- **Dependencies**: [Any prerequisites]

## Priority: Medium
### [Feature Title]
- **Problem it solves**: [...]
- **Proposed solution**: [...]
- **Effort**: [...]

## Priority: Low / Future
### [Feature Title]
- **Problem it solves**: [...]
- **Proposed solution**: [...]
- **Effort**: [...]

## Icebox (no current priority)
- [Idea 1] — [one-line description]
- [Idea 2] — [one-line description]
```

---

## USER-STORIES.md

```markdown
# User Personas & Stories

## Personas

### [Persona Name] — [Role/Type]
- **Goal**: [What they're trying to achieve]
- **Context**: [How they use this product, frequency, skill level]
- **Frustrations**: [What they struggle with today without this product]

---

## User Stories

### Authentication
- As a **[persona]**, I want to [action] so that [benefit].
- As a **[persona]**, I want to [action] so that [benefit].

### Core Features
- As a **[persona]**, I want to [action] so that [benefit].
- As a **[persona]**, I want to [action] so that [benefit].

### Data Management
- As a **[persona]**, I want to [action] so that [benefit].
- As a **[persona]**, I want to [action] so that [benefit].

---

## Acceptance Criteria Template
For key stories, note the criteria for "done":

### Story: [Title]
**Given** [precondition]
**When** [action]
**Then** [expected outcome]
```

---

## DECISIONS.md

```markdown
# Product & Architecture Decisions

Lightweight decision log (ADR-style). Records significant choices and their rationale to guide future development.

---

## [Decision Title] — [Date]
**Status**: Accepted / Deprecated / Superseded by [link]

**Context**: [What situation or problem led to this decision?]

**Decision**: [What was decided?]

**Rationale**: [Why this option over alternatives?]

**Consequences**: [What does this mean going forward? Trade-offs?]

---

## [Next Decision Title] — [Date]
...
```

---

## Feature Proposal Template (for BACKLOG.md entries from new-features mode)

```markdown
### [Feature Name]
**Value**: [Who benefits and how — write in user terms]
**Gap identified**: [What in the codebase or product triggered this idea]
**Suggested approach**: [High-level implementation direction — what to build, not how to code it]
**Effort estimate**: Low / Medium / High
**Priority recommendation**: Must-have / Nice-to-have / Future
**Dependencies**: [Anything that must exist first, or risks to consider]
```
