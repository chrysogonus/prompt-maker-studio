# User Personas & Stories

> Last reviewed against the codebase: 2026-10-16 (published 0.5.1); later releases are listed in
> [FEATURES.md](FEATURES.md) and not yet reflected here. Stories below describe implemented behavior except the explicitly planned section.

## Personas

### Alex — Frequent chat-assistant user
- **Goal**: Keep the prompts that work and reuse them in seconds
- **Context**: Writes prompts in ChatGPT, Claude or Gemini many times a week — status updates, email replies, summaries, learning, personal planning. Comfortable with structure and `{{placeholders}}`, not a prompt engineer. Mostly at a desk, sometimes grabbing a prompt on a phone
- **Frustrations**: Good prompts get lost in old chats and notes; small improvements are not kept; adapting a prompt to today's details means editing text by hand

### Alex in ChatGPT
- **Goal**: Save and fetch library prompts without leaving ChatGPT
- **Context**: Uses the MCP plugin to store a prompt worked out in conversation, or to pull one back in
- **Frustrations**: Two copies of a prompt that disagree — one in the app, one in the chat

---

## User Stories

### Account
- As **Alex**, I want to register with a username, password and recovery email so that my library is private and recoverable.
- As **Alex**, I want my session to renew while I work and to expire with a clear message so that I never lose an edit to a silent logout.
- As **Alex**, I want to sign out everywhere, change my password, export everything, or delete my account from one Settings page.

### Writing a prompt
- As **Alex**, I want a prompt to be a few named sections I can rename, reorder and remove so that its structure matches how I think about it.
- As **Alex**, I want to name a section "Output format" and let the app handle the tag so that names read like writing.
- As **Alex**, I want to start from a short starter template or paste a prompt I already use and have it split into sections so that I do not face a blank page.
- As **Alex**, I want to mark the parts that change with `{{variables}}` and give each a hint so that filling the prompt in later is obvious.
- As **Alex**, I want gentle warnings about empty sections and unevenly opened tags so that mistakes are visible but never block me.

### Using a prompt
- As **Alex**, I want to see exactly the text I will paste while I write so that nothing surprises me in the chat app.
- As **Alex**, I want to fill in the variables and copy the result in one click, and be told which ones I left as placeholders.
- As **Alex**, I want to copy the bare template from the library without opening it.
- As **Alex**, I want a saved prompt opened on my phone to go straight to filling it in.

### Keeping and organising prompts
- As **Alex**, I want to save explicitly, with an optional note, and press Ctrl/⌘+S to do it, so that versions mean something.
- As **Alex**, I want unsaved edits restored if I leave or reload so that I never lose work, without a "leave page?" prompt.
- As **Alex**, I want to compare an earlier version with the current text and restore it, knowing a restore can itself be undone.
- As **Alex**, I want my library to open on the most recently edited prompts, searchable, in folders and favourites.
- As **Alex**, I want to rename or remove a folder without deleting its prompts.
- As **Alex**, I want a delete I regret to be undoable for a few seconds.
- As **Alex**, I want my old unnamed history entries kept somewhere I can review and tidy, not silently deleted.

### Working from ChatGPT
- As **Alex in ChatGPT**, I want to save, update and fetch library prompts through the plugin so that the web app and ChatGPT share one library.
- As **Alex in ChatGPT**, I want an update to be rejected if the prompt changed elsewhere in the meantime so that I never overwrite my own edits.

### AI connection
- As **Alex**, I want Paste a prompt to tell me what it needs and where to set it up when no AI connection exists.
- As **Alex**, I want to connect my own OpenAI-compatible provider, or use the server's default, and see that my key is never shown again.

### Improving and testing a prompt
- As **Alex**, I want to answer clarifying questions, review section diffs, apply a refinement with Undo, and save only when ready.
- As **Alex**, I want to test a filled draft once without saving it, after reviewing the provider and charge notice.
- As **Alex**, I want to create reusable test cases with automatic checks, AI review or manual ratings, run them explicitly and compare historical outputs.
- As **Alex**, I want to mark inputs as required and load saved examples only when I ask, so I know what I am copying or sending to AI.
- As **Alex**, I want to point refinement at test results that went badly and check a draft against my test cases before applying it, so I know an edit is actually better.

### Planned stories (not yet implemented)
- As **Alex**, I want to give direct refinement instructions and accept individual section edits instead of applying a whole proposal.
- As **Alex**, I want evaluation scores calibrated against human judgment so the numbers have a validated meaning.
- As **Alex**, I want to select several recovered prompts, or find duplicates, and delete them together.
- As **Alex**, I want to copy a prompt with Markdown headings instead of tags.

---

## Acceptance Criteria

### Story: Register and land in the library
**Given** registration is open, or no account exists yet
**When** they submit a valid username, password and email
**Then** they are signed in and see an empty library offering New prompt, Paste a prompt and starter templates

### Story: Write and save a new prompt
**Given** a signed-in user on New prompt
**When** they write sections and press Save or Ctrl/⌘+S, then enter a name and optional folder
**Then** the prompt is created from its sections, the editor moves to its own URL, and it appears in the library and sidebar counts

### Story: Fill in and copy
**Given** a saved prompt with variables
**When** the user opens it, types values in the preview's Filled mode and clicks "Copy filled prompt"
**Then** the clipboard holds the rendered text with the values substituted; missing optional inputs are identified, while missing required inputs block normal filled copying and offer an explicit Copy with placeholders action

### Story: Paste a prompt
**Given** a signed-in user with an AI connection (their own or the server default)
**When** they paste text into Paste a prompt and choose Create template
**Then** they review sections and extracted inputs before copying or applying to the editor with Undo; Save persists the template, and retaining example inputs is an explicit choice. Without a connection the dialog explains why and links to Settings

### Story: Compare and restore a version
**Given** a prompt saved at least twice
**When** the user opens Tools → History, selects an earlier version and restores it
**Then** the diff showed what changed, the restored sections are live, and the replaced state is a new version

### Story: Recover after an edit conflict
**Given** the same prompt open in two tabs
**When** one tab saves and the other then saves different edits
**Then** the second save is rejected, its edits stay on screen, Compare shows what the other tab saved, and after "Keep my edits" saving deliberately replaces it, or "Use the saved version" discards the edits

### Story: Remove a folder
**Given** a folder with prompts in it
**When** the user removes the folder and confirms
**Then** its prompts are moved to Unfiled and none are deleted

### Story: Save from ChatGPT
**Given** a ChatGPT conversation linked to the user's account
**When** ChatGPT calls `save_prompt` with a name and sections
**Then** the prompt is stored exactly as if saved in the web app and appears in the library
