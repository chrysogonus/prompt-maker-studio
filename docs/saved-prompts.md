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
- `{{variable}}` placeholders start with an ASCII letter or `_`, followed by
  letters, digits, `_` or `-`; optional whitespace inside the braces is accepted.
  Each distinct name becomes a field to fill in.

The server renders stored text (`generated_prompt`); clients send sections
(`fields`) and are rejected with 422 if they send generated text. The frontend mirrors
that rendering for its default live preview (`frontend/src/lib/sections.ts`,
`backend/app/services/prompt_sections.py`). The shared
[rendering fixtures](../contracts/README.md) check that both implementations agree.

Expand Output options and choose Plain text in the editor's Output format control to omit the app's section
wrappers. Sections are joined with a blank line, while literal tags inside their
content remain untouched. Preview, copying and Try once use the selected format;
stored sections are unchanged. The library menu also offers Copy as plain text.

## Writing and saving

- **New prompt** opens the editor with one empty section. Starter templates and Paste a prompt sit
  above it; conversion needs an effective AI connection (the user's own or the operator's
  optional server default) and explains how to add one if neither exists.
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

## Refinement

Choose **Refine** to work on the current sections, including a new or unsaved
prompt. Explicitly request questions, answer them, then request a draft, or choose
**Improve without questions** for a draft that tightens the wording without new
requirements. Questions never ask what a `{{variable}}` should be. Review
section-level changes or the full draft, edit the proposal and apply locally
with Undo; normal Save persists it. After Undo the same draft can be applied again
without another AI call. Closing the panel retains the session in
memory, while navigation/reload discards the session. Changing the source
sections requires restarting. Refinement replaces the desktop preview and uses
a full-screen dialog on phones. Each AI request shows provider and charge
context; opening the panel alone makes no AI call.

## Filling in and copying

The preview pane shows the exact text that will be copied. For prompts with variables it has two
modes:

- **Template** — the text with `{{placeholders}}`; "Copy template".
- **Filled** — an input per variable, using the variable's hint as its placeholder; "Copy filled
  prompt". Required inputs block ordinary filled copying until completed; Copy with placeholders
  explicitly allows unresolved inputs. Optional inputs retain the existing copying behavior.

Hints are edited in the Variables panel under the sections. Each variable's Options
disclosure contains its required flag and example. The panel links to the variables
guide; Guides is also available in app navigation. Markup warnings are advisory and
can be dismissed without altering the text. A hint whose variable no longer
appears is kept, marked as unused, until removed. Variables are optional by default; required inputs
and examples are editable settings persisted on Save. Load example inputs is explicit and examples
never become section content. Ordinary filled inputs are temporary. Converted inputs recover in
browser-local drafts; Keep these inputs as examples is unchecked by default and only saves example
metadata when opted into and followed by Save.

In the preview, open **Test with AI** to reach **Try once**. It runs the filled prompt through the configured provider without saving it or creating a
separate Playground history. Its result includes the output text, provider and model;
token usage is recorded in the spend ledger. Conversion, refinement and Try once show provider/model
and billing context before execution. Saved prompts open the evaluation workspace
from Tools → Evaluate: edit test cases, import/export case CSV, review AI suggestions,
run explicitly, inspect and compare historical outputs, and submit manual ratings.
Saving a prompt never starts an evaluation.

At widths up to 1200px the editor has Edit and Fill and copy tabs, and saved
prompts open on Fill and copy. Library Fill and copy links open a focused form
on every screen size; Edit template returns to the section editor. Discarding
template changes retains filled values for variables still in the saved prompt.
Clear inputs resets those separately. Recovered drafts are identified
above both panes as stored only in the current browser.

## Versions

- Every save that changes sections or variable settings snapshots the previous state. A note
  entered on Save describes the resulting state, including the current version. Migration 025
  preserves original history notes as `legacy_note` while correcting their association; recovery
  notes stay with their original snapshots.
- Open **Tools → History** on a saved prompt. The panel lists versions (newest first, the current one on top), shows a word-level
  diff of any version against the current text, and restores it. A restore snapshots the state it
  replaces, so it can be undone, and is unavailable while there are unsaved edits.
- Renaming, filing or favoriting does not create a content version. REST updates
  advance the concurrency timestamp even without a content snapshot; content
  recency advances only for section/variable changes and restores. The editor avoids
  sending an unchanged content save. REST accepts an optional concurrency token,
  while the editor and MCP updates always send one.
- Versions recorded before 0.3.0 can hold hand-edited text that disagrees with their sections.
  Restoring one recovers sections from its text, the same way migration 023 recovered live prompts.
  Older snapshots without variable metadata retain the current variable settings;
  newer snapshots restore the saved settings.

## The library

- `/library` lists every prompt by most recent edit, in a list or a grid (the default is a
  Settings preference), with search across names, folders and section text; every word
  must match, in any order.
- Choose Recently edited or Title A–Z sorting. Select prompts to file them together
  (failed moves stay selected for retry) or delete them together, with one Undo. Grid metadata sits separately from actions.
- **Add existing prompts** is the library's one entry point for bringing prompts in. It
  accepts pasted text, a JSON export or Markdown (`# Title`, optional `## Section`
  headings), up to 100 prompts and 5 MB per import; format details are folded away.
  Review and edit names/folders, with section text shown for up to five prompts, before
  creating new copies. Sections, variable settings and favorites are retained; history,
  dates and notes are not restored. Failed items remain for retry. After success it
  offers Open imported prompts (the prompt, its folder, or the library) or Import more.
- A single pasted note can be kept as written or sent to **Make reusable with AI**, which
  opens the editor's Paste a prompt with the text filled in (handed over once through
  session storage).
- A single plain note needs no heading. Uploading suggests its filename as the title;
  pasted notes have an editable title. Simple one-line YAML `title` values can supply
  a title; complex YAML uses the fallback. Note metadata is tidied: front matter, Notion
  page properties (a "Key: value" block under the title naming Tags, Created, Status and
  similar), Obsidian callouts, `%% comments %%`, Dataview queries and trailing `#tags`,
  and Notion `<aside>` callouts are removed; `[[links]]` and `==highlights==` read as
  text, and embedded images or files are left out. The rest is read like Markdown, so the
  first heading (a pasted page may start at `##`) becomes the title and smaller headings
  become sections, named without list numbers, accents or punctuation (`## 1. Role` is
  Role, a repeated `## Example` is Example 2). The first tag suggests a
  folder and a Notion favourite stays a favourite; the preview can keep the original
  text instead.
- Notion's **Export → Markdown & CSV** `.zip` can be chosen as it is: its pages are read
  (the browser unzips it; nested part zips too, up to 50 MB, without the part names
  becoming folders), and a database `.csv` becomes one prompt per row (Name or Title, a
  Prompt/Content column or else the longest text column, Tags as the folder, and a
  Favourite status). A database's CSV is read only when its rows were not also exported as
  pages, from a zip or a chosen folder alike, and `X_all.csv` is preferred to `X.csv`.
  Property lines that hold the prompt text are kept; only metadata such as Tags, Created
  and Status is removed. Binary files are refused with an explanation, and an HTML export
  with advice to export Markdown & CSV instead.
- A previewed prompt whose title is already in the library is skipped unless
  **Import a copy anyway** is ticked, so re-importing a vault does not duplicate it.
- The preview offers to turn placeholders such as `[TOPIC]`, `{audience}` or
  `<transcript>` into inputs (each can be unticked; `[[wiki-links]]` are never offered),
  keeping each placeholder's wording as the input's hint, with Undo, and a **Folder for all prompts** field when
  several prompts are imported.
- Paste a prompt offers Save as written without AI. The source becomes one Task
  section, preserving its text. Prompts with a single section copy as plain text by
  default; Output options can add the section tags.
  Optional AI conversion still offers review before applying.
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
- **Duplicate** creates a unique name, copies sections, folder, variable settings,
  legacy tags and evaluation cases, and starts without favorite status, version
  history or run history.
- **Recovered history** holds the unnamed prompts the old History tab listed, named by date by
  migration 024. Rename, move or delete them like any other prompt.

## Data model

```typescript
interface PromptHistoryResponse {
  id: number;
  name: string | null;           // set for every prompt since migration 024
  fields: PromptField[];         // the sections, in order
  generated_prompt: string;      // rendered by the server from `fields`
  created_at: string;            // ISO timestamp; SQLite values are normally naive UTC
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
