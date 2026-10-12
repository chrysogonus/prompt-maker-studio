# Prompts, the Library, and Versions

How prompts are written, stored, organised and versioned since the 0.3.0 redesign. For the
complete feature list see [product/FEATURES.md](../product/FEATURES.md); for the reasoning,
[product/DECISIONS.md](../product/DECISIONS.md).

## A prompt is a list of sections

Each prompt has a name and an ordered list of **sections**. A section has a display name
("Role", "Output format") and text. The text the user copies is rendered from the sections:

```text
<ROLE>
You are a patient tutor.
</ROLE>

<OUTPUT_FORMAT>
Explain {{topic}} in three short steps.
</OUTPUT_FORMAT>
```

- The tag is the display name with whitespace collapsed, spaces turned into underscores and
  letters upper-cased. Names must start with a letter or underscore and may use letters,
  digits, spaces, `_` and `-`.
- Two sections that render to the same tag (`Role` and `role`, `a b` and `a_b`) are rejected.
- Section text is kept verbatim — `<`, `>` and `&` are never escaped.
- `{{variable}}` placeholders (letters, digits, `_`, `-`) become fields to fill in.

The server is the only place text is rendered and stored (`generated_prompt`); clients send
sections (`fields`) and are rejected with 422 if they send text. The frontend mirrors the same
rendering for its live preview (`frontend/src/lib/sections.ts`, `backend/app/services/prompt_sections.py`).

## Writing and saving

- **New prompt** opens the editor with one empty section. Starter templates and Paste a prompt sit
  above it; conversion needs an AI connection and explains how to add one if there is none.
  Paste a prompt stages XML-style sections and detected variables for review. Original values
  are filled in; names/values can be edited or an input kept fixed. Copy directly, or choose
  Use in editor to replace the draft with Undo. Save persists the template.
- **Save** (button or Ctrl/⌘+S) on a new prompt asks for a name and an optional folder, creates
  it with `POST /api/prompts`, and moves to its stable URL `/editor/{id}`.
- On a saved prompt, Save sends the sections with `PATCH /api/prompts/{id}`. A version note can be
  typed beside the button. Saving unchanged sections and variable metadata does nothing.
- Unsaved edits are kept as a local draft per user and prompt. Coming back restores them with a
  "Discard changes" option, provided the saved prompt has not changed in the meantime. Drafts are
  cleared on sign-out. Pasted source, review edits and converted input values also recover in the
  same account-scoped browser drafts, including after saving a converted prompt for the first time.
- If the prompt was saved somewhere else since it was opened (another tab, the ChatGPT plugin),
  the save is rejected with 409. The editor keeps the edits and offers "Load latest version";
  saving after that deliberately replaces the other version.

## Filling in and copying

The preview pane shows the exact text that will be copied. For prompts with variables it has two
modes:

- **Template** — the text with `{{placeholders}}`; "Copy template".
- **Filled** — an input per variable, using the variable's hint as its placeholder; "Copy filled
  prompt". Required inputs block ordinary filled copying until completed; Copy with placeholders
  explicitly allows unresolved inputs. Optional inputs retain the existing copying behavior.

Hints are edited in the Variables panel under the sections. A hint whose variable no longer
appears is kept, marked as unused, until removed. Variables are optional by default; required inputs
and examples are editable settings persisted on Save. Load example inputs is explicit and examples
never become section content. Ordinary filled inputs are temporary. Converted inputs recover in
browser-local drafts; Keep these inputs as examples is unchecked by default and only saves example
metadata when opted into and followed by Save.

Try once runs the filled prompt through the configured provider without saving it or creating a
separate Playground history. Conversion, refinement, Try once and evaluation show provider/model
and billing context before execution.

On phones the editor has Edit and Fill and copy tabs, and saved prompts open on Fill and copy.

## Versions

- Every save that changes sections or variable settings snapshots the previous state. A note
  entered on Save describes the resulting state, including the current version. Migration 025
  preserves original history notes as `legacy_note` while correcting their association; recovery
  notes stay with their original snapshots.
- The History panel lists versions (newest first, the current one on top), shows a word-level
  diff of any version against the current text, and restores it. A restore snapshots the state it
  replaces, so it can be undone, and is unavailable while there are unsaved edits.
- Versions recorded before 0.3.0 can hold hand-edited text that disagrees with their sections.
  Restoring one recovers sections from its text, the same way migration 023 recovered live prompts.

## The library

- `/library` lists every prompt by most recent edit, in a list or a grid (the default is a
  Settings preference), with search across names, folders and section text.
- The sidebar narrows it to **Favorites**, a **folder**, or **Unfiled**.
- Library cards expose Copy template and, for prompts with variables, Fill and copy, which opens
  the filling view directly on desktop and phones. Each prompt's menu: Copy template, Rename,
  Move to folder, Duplicate, Delete. Delete takes effect
  at once with a 5-second Undo and only then calls the server; a delete still waiting is sent if
  the page is left.
- **Folders** are labels on prompts (`prompts.folder`). A folder exists while a prompt is filed in
  it. A folder view can rename the folder (`PATCH /api/prompts/folders?name=`, merging onto an
  existing name) or remove it (`DELETE /api/prompts/folders?name=`), which unfiles its prompts and
  deletes none. Neither changes the prompts' edit times.
- **Recovered history** holds the unnamed prompts the old History tab listed, named by date by
  migration 024. Rename, move or delete them like any other prompt.

## Data model

```typescript
interface PromptHistoryResponse {
  id: number;
  name: string | null;           // set for every prompt since migration 024
  fields: PromptField[];         // the sections, in order
  generated_prompt: string;      // rendered by the server from `fields`
  created_at: string;            // UTC, sent without a zone marker
  updated_at?: string | null;    // the optimistic-concurrency token
  folder?: string | null;
  is_favorite?: boolean;
  current_note?: string | null;
  variable_metadata?: Record<string, {
    type: string; description?: string | null; required?: boolean; example?: string | null;
  }> | null;
}

interface PromptField {
  name: string;    // display name, e.g. "Output format"
  content: string; // section text, verbatim
}
```

Tags remain legacy export data. Variable types remain in metadata for compatibility, while the
editor uses text inputs and provides hints, required flags and optional examples.

## Future enhancements

See [product/BACKLOG.md](../product/BACKLOG.md). Open items closest to this area: a cleanup for
Recovered history (bulk delete, duplicates), version milestones, a trash with restore, importing
from a file, and a Markdown output option.
