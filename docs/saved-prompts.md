# Saved Prompts Feature

This feature lets you save, organize, and switch between multiple prompt configurations, with full version history. As of the 2026-07-12 UI redesign, saved prompts live across three screens: **Library** (browse/organize), **Editor** (compose new / edit existing), and **Dashboard** (favorites + usage).

## Features

### 💾 Save Prompts
- Compose a prompt in the Editor (`/editor/new`): add fields with **+ Add Field**, then click **Generate Prompt**
- Click **Save** in the output panel and give it a name (e.g. "Fantasy Character Creator", "Marketing Copy")
- You're redirected to the prompt's stable Editor/Detail URL (`/editor/{id}`)
- Saved prompts are stored in the backend database under your account

### ✏️ Edit a Saved Prompt
- Open a saved prompt from the Library or Dashboard to land on its Editor/Detail screen
- Edit the compiled template directly in the monospace textarea, then click **Update**
- Every content edit to an already-saved prompt automatically snapshots the *prior* state as a new version before applying the change — see **Version history** below
- Add or remove **tags** via the chip input in the right-hand panel

### 🕒 Version History & Restore
- The Editor/Detail screen's **Version history** panel lists every prior state (version number, note, author, date), newest first
- Click a version row to preview its content in a read-only textarea
- Click **Restore this version** to bring it back — restoring itself snapshots the state it's replacing first, so a restore is always undoable

### 📋 Browse & Organize (Library)
- The **Library** screen (`/library`) shows all saved prompts as a grid or list (toggle in the top-right)
- Filter by the **search box** (matches name and generated text) or by **tag** (pill row, populated from your own tags)
- Star a card's ★ to favorite it — favorited prompts appear on the Dashboard
- Each card/row shows its **folder** label (if set) and **tags**
- **Rename**, **Duplicate**, and **Delete** are available as inline actions on every card/row
- A separate **History** tab shows the paginated, searchable log of every prompt generation, including unnamed (not-yet-saved) ones

### ⭐ Favorites
- Star any saved prompt from the Library
- Favorited prompts appear in the **Favorites** grid on the Dashboard for one-click access

### ▶️ Test in the Playground
- From Editor/Detail, click **▶ Test in playground** to open `/playground/{id}`
- Fill in values for any `{{variable}}` placeholders detected in the template, pick a model, and click **Run**
- This makes a real call against your own connected LLM provider, billed to your account — see [the main README](../README.md#api-reference-overview) for details. If you haven't connected a provider under Settings → API access, the Playground shows a disabled notice linking there instead

### ➕ Create New Prompt
- Click **+ New prompt** (Dashboard, Library, or the nav bar's **Editor** tab) to open `/editor/new`
- Clears all fields for a fresh start; does not affect your other saved prompts

### 🗑️ Delete Prompts
- Click **Delete** on any Library card/row
- Deleted prompts (and their version history) cannot be recovered

## How It Works

### Saving a New Prompt
1. From the Dashboard or Library, click **+ New prompt**
2. Add fields with **+ Add Field** and fill them in
3. Click **Generate Prompt**
4. Review the generated XML output
5. Click **Save** in the output panel and enter a name

### Editing an Existing Prompt
1. Open the prompt from the Library, History tab, or Dashboard favorites
2. Edit the template text directly, or add/remove tags
3. Click **Update** — this snapshots the prior state as a new version automatically

### Restoring a Prior Version
1. On the prompt's Editor/Detail screen, open **Version history**
2. Click a version to preview it
3. Click **Restore this version**

## Storage

Prompts are saved in the backend database as named prompt records. A prompt is considered saved when its `name` is non-null, and every saved prompt (and its version history) is scoped to the authenticated user's account.

- Data persists across browser sessions and devices
- Stored server-side in the `prompts` table, with historical snapshots in `prompt_versions`
- Each user only sees prompts (and versions) they own
- Download a full JSON export of everything you own — fields, folder, tags, generated text, and version history — from **Settings → Data → Export**

## Saved Prompt Structure

Each saved prompt contains:
```typescript
interface SavedPrompt {
  id: string;              // UI identifier derived from backend ID
  name: string;             // Your custom name
  promptId: number;        // Backend DB ID
  fields: PromptField[];   // Dynamic field array: [{name, content}, ...]
  generatedPrompt: string; // The XML output
  savedAt: string;         // ISO 8601 date string
  updatedAt?: string | null;
  folder?: string | null;
  isFavorite?: boolean;
  tags?: string[];
}

interface PromptField {
  name: string;    // Field label, e.g. "goal", "tone"
  content: string; // Field body text
}
```

The frontend maps backend `PromptHistoryResponse` records into this UI shape when saved prompts load.

## UI Components

### Library (`frontend/src/app/(app)/library/page.tsx`)
- Grid/list view of saved prompts with search, tag filters, and favorite toggling
- Rename, duplicate, and delete actions per card/row
- A separate History tab for the full generation log

### EditorDetail (`frontend/src/components/EditorDetail.tsx`)
- Breadcrumb, header (name/folder/edited-date, Update button, "Test in playground" link)
- Template textarea, Version history panel with restore, Variables panel (auto-derived), tag chips

### SavePromptDialog (`frontend/src/components/SavePromptDialog.tsx`)
- Modal dialog for naming a prompt when first saving it (only — `EditorDetail`'s subsequent **Update** action PATCHes directly without reopening this dialog, since the name is already set)
- Input validation (max 100 characters)

### OutputPanel (`frontend/src/components/OutputPanel.tsx`)
- Shown on the "new prompt" compose flow (`/editor/new`) only
- **Save** button appears once a prompt has been generated

## Keyboard Shortcuts

While the save dialog is open:
- **Enter** — Save the prompt
- Click outside the dialog or use **Cancel** to cancel

## Tips

1. **Descriptive Names**: Use clear names like "Blog Post - Tech Review" instead of "Prompt 1"
2. **Tags over ad hoc naming**: Use tags to group related prompts (e.g. `customer-facing`, `gpt-4o`) instead of encoding categories into the name
3. **Version history is automatic**: You don't need to manually track changes — every edit to a saved prompt is preserved and restorable
4. **Backup**: Prompts live in the backend database; include them in database backups, or use Settings → Data → Export for a personal copy
5. **New Prompt**: Always start from `/editor/new` when beginning fresh, to avoid accidentally editing an existing prompt

## Future Enhancements

See `product/BACKLOG.md` for the full list. Notable open items relevant to this feature:
- **Import from file** — the reverse of the existing JSON export
- **Relational folders/tags** — currently simple columns; may be promoted to managed tables if cross-tag analytics become valuable

Per-variable types and descriptions are **implemented**, not pending: the
Editor's Configuration tab edits them, and they persist through the
`variable_metadata` column (`VariableMetadataItem` in
`backend/app/models/schemas.py`).
