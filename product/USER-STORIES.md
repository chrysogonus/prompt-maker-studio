# User Personas & Stories

> Last reviewed against the codebase: 2026-07-26.

## Personas

### Alex — Developer / AI Practitioner
- **Goal**: Build and iterate on high-quality prompts for LLM-powered tools and scripts
- **Context**: Uses AI tools daily; knows prompt structure matters but finds manually formatting XML or Markdown tedious; runs workflows on multiple machines
- **Frustrations**: Re-creates the same prompts from scratch because there is no central place to save and reuse them; inconsistent formatting means prompts behave differently across tools

### Jordan — Prompt Hobbyist
- **Goal**: Explore what AI can do; build prompts for creative and personal projects
- **Context**: Non-technical user; relies entirely on the UI; works from ideas rather than formal prompt engineering knowledge
- **Frustrations**: Doesn't know what "fields" to create; blank editor is intimidating; loses work when the browser tab is closed

### Riley — Individual Contributor
- **Goal**: Maintain a dependable personal library of prompts for recurring work
- **Context**: Reuses prompts for writing, summarizing, and coding; wants to measure whether edits improve results before adopting them
- **Frustrations**: Prompt copies drift across documents; changes are hard to compare; quality judgments are often anecdotal rather than repeatable

---

## User Stories

### Authentication
- As **Alex**, I want to register with a username, password, and recovery email so that my prompts are private, persist between sessions, and remain recoverable.
- As **Jordan**, I want to log in quickly and stay logged in so that I don't have to re-authenticate every time I open the app.
- As **Alex**, I want my session to expire gracefully so that I get a clear message and am redirected to login rather than seeing a broken experience.

### Prompt Creation
- As **Alex**, I want to add and remove named fields freely so that I can structure a prompt exactly how my workflow requires.
- As **Jordan**, I want to import free-form text and have the app suggest field names and content for me so that I can start with a rough idea instead of a blank form.
- As **Alex**, I want field name uniqueness enforced so that my generated XML doesn't have duplicate tags that confuse the LLM.
- As **Alex**, I want my field names to be sanitized in real-time (e.g. converting spaces to underscores) so that I don't trigger validation errors on generation.
- As **Alex**, I want to reorder fields with up/down arrows so that I can control the order the LLM sees them in (e.g. instructions before examples) without deleting and recreating fields.
- As **Jordan**, I want AI-assisted screens to tell me when I have not connected a provider and link me directly to Settings so that I can enable the workflow instead of receiving a confusing failure.
- As **Jordan**, I want a starter kit of common field patterns so that I have a useful starting point without expert knowledge.

### Prompt Output
- As **Alex**, I want to copy the generated XML prompt to clipboard in one click so that I can paste it into another tool immediately.
- As **Alex**, I want to type variable values into form inputs when placeholders are detected in my prompt so that I can copy the fully compiled output without manual find-and-replace.
- As **Riley**, I want consistent XML formatting in every generated prompt so that repeated workflows use the same structure.
- As **Alex**, I want preflight warnings for unresolved variables and structural problems so that I can fix them before copying or paying to run the prompt.

### Saved Prompts & History
- As **Alex**, I want to save a named prompt template so that I can reload it on future visits without rebuilding it.
- As **Jordan**, I want my active work in the editor to be auto-saved locally so that I don't lose my dynamic fields if I accidentally reload the page or close the tab.
- As **Alex**, I want unsaved edits to an existing prompt to recover after a reload or accidental navigation so that substantial revisions are not lost.
- As **Jordan**, I want my saved prompts to be available on any device I log in from so that I don't lose them when I clear my browser.
- As **Riley**, I want to see a history of all my past generated prompts so that I can revisit and reuse prompts that worked well.
- As **Alex**, I want to duplicate a past prompt so that I can iterate on a working version without modifying the original.
- As **Riley**, I want to tag and favorite prompts so that I can quickly find important templates by project or use case.

### Testing, Evaluation & Refinement
- As **Alex**, I want to run a saved prompt with realistic variable values so that I can inspect output, latency, token usage, and cost before integrating it elsewhere.
- As **Riley**, I want repeatable rule, AI-judge, or manual test cases so that I can compare prompt quality across edits.
- As **Riley**, I want to import and export eval cases as CSV so that I can maintain larger datasets outside the browser.
- As **Alex**, I want an evaluation to run automatically after an update when I opt in so that regressions are caught during iteration.
- As **Alex**, I want AI to ask clarifying questions and propose a visible revision diff so that I remain in control of any refinement.
- As **Riley**, I want version comparison and reversible restore so that experimentation never destroys a previously working prompt.
- As **Riley**, I want to inspect and compare the actual outputs from two evaluation runs so that I can understand why a score improved or regressed.
- As **Alex**, I want AI to propose a reviewable set of evaluation cases from my prompt so that I can establish useful quality coverage without designing every test from scratch.
- As **Alex**, I want rule checks that can assert "must not contain", match a regex, or require valid JSON so that I can verify negative and structured requirements without paying for an AI judge.
- As **Riley**, I want the AI judge to explain a score with concrete strengths and weaknesses — having seen the prompt that produced the output — so that a low score tells me what to fix rather than just that something is wrong.
- As **Alex**, I want to edit the AI's proposed revision before accepting it so that I can fix small issues in the draft without rejecting the whole refinement.
- As **Riley**, I want a one-click path from a failing evaluation result into the Playground with that case's inputs so that I can debug the failure interactively.
- As **Riley**, I want a large evaluation to run its cases in parallel with per-case timeouts so that a Judge-heavy run finishes quickly instead of hanging or timing out the whole request.
- As **Alex**, I want Playground, evaluation, refinement, and AI-import usage attributed to my provider and counted consistently so that estimated spend reflects the product workflows the app performs.

### Theme & Preferences
- As **Jordan**, I want to switch between dark and light mode so that the app is comfortable to use in different lighting conditions.

### LLM Provider Access
- As **Alex**, I want to connect my own OpenAI, Anthropic, Gemini, Ollama, vLLM, or compatible endpoint so that every AI-assisted feature runs on infrastructure and credentials I control.
- As **Alex**, I want my hosted-provider API key encrypted at rest and never returned by the API so that saving a connection does not expose the usable secret in the UI or database.
- As **Alex**, I want to test and disconnect a provider connection from Settings so that I can verify configuration before spending on a workflow and erase the stored credential when I no longer need it.
- As **Jordan**, I want the configured model to live with the provider connection so that AI import, refinement, evaluation, and Playground testing use one understandable default.

### Account Management
- As **Alex**, I want to change my username so that I can update my handle without creating a new account and losing all my saved prompts.
- As **Alex**, I want to update my recovery email so that password-reset messages reach the correct address.
- As **Alex**, I want to change my password directly in the app while logged in so that I don't have to log out, wait for an email, and use a separate reset page just to rotate my credentials.

### Prompt Generation & Output
- As **Alex**, I want to trigger Generate via Ctrl+Enter (or ⌘↵ on Mac) so that I can stay in keyboard flow without reaching for the mouse.
- As **Alex**, I want to see character count, word count, and estimated token count above my generated prompt so that I can gauge whether the prompt fits within a model's context limit before copying it.

### Saved Prompts & History
- As **Riley**, I want to filter saved prompts and history by name or content so that I can find a specific prompt instantly rather than scrolling through a long list.
- As **Alex**, I want the "last edited" date on a saved prompt to reflect when I last updated it — not when I first created it — so that I can identify my most recently worked-on templates at a glance.
- As **Riley**, I want history search to look across my entire history, not just the page currently loaded, so that I don't miss an older prompt.
- As **Riley**, I want a "Load more" option in my history so I'm not limited to the most recent handful of prompts.
- As **Alex**, I want to rename a saved prompt directly from the sidebar without loading it into the editor first, so that routine housekeeping doesn't interrupt my current work.

### AI Import
- As **Jordan**, I want the AI text importer panel to be collapsed by default so that it doesn't take up editor space when I'm not using it, but expands again where I left it the next time I visit.

### Planned Stories (Not Yet Implemented)
- As **Alex**, I want Markdown or JSON generation in addition to XML so that the output fits different downstream tools.
- As **Riley**, I want to import a previously exported prompt library so that I can restore or migrate my workspace.
- As **Riley**, I want to see per-case evaluation progress and cancel remaining work while retaining completed results so that long runs stay understandable and controllable.
- As **Riley**, I want to attach change notes and milestone labels to prompt versions so that I can recognize why a version matters.
- As **Jordan**, I want deleted prompts to remain restorable for a limited time so that an accidental delete does not permanently erase my work.
- As **Alex**, I want to continue a Playground test through multiple conversation turns so that I can validate prompts intended for chat workflows.

---

## Acceptance Criteria

### Story: Register and log in
**Given** a new visitor on the app
**When** they submit a valid username, password, and email address via the register form
**Then** their account is created, they are automatically logged in, and they see the authenticated Dashboard

### Story: AI import from free-form text
**Given** a logged-in user on the main editor
**And** they have connected an LLM provider in Settings
**When** they paste free-form text into the importer and submit
**Then** the editor is populated with named prompt fields parsed from the text, ready for editing and generation

### Story: Connect an LLM provider
**Given** a logged-in user in Settings → API access
**When** they choose a supported hosted or self-hosted provider, enter its endpoint/model and any required API key, and save
**Then** the app stores a usable per-user connection, never returns the full key, and enables AI-assisted workflows for that account

### Story: Generate and copy a prompt
**Given** a logged-in user who has filled in at least one field
**When** they click Generate
**Then** the output panel shows a formatted XML prompt, and clicking Copy copies it to the clipboard

### Story: Change password while logged in
**Given** a logged-in user who knows their current password
**When** they open "Change password", enter the current and a new password, and submit
**Then** the password is updated, their current session stays valid (no forced logout), and the old password no longer works on the next login

### Story: Save and reload a prompt
**Given** a logged-in user who has generated a prompt
**When** they click Save, provide a name, and confirm
**Then** the prompt appears in the saved prompts list and can be reloaded in a future session

### Story: Recover unsaved prompt edits
**Given** a logged-in user who has changed an existing saved prompt without saving
**When** they reload or return to that prompt after an interrupted navigation
**Then** the local draft is restored with a visible unsaved-draft banner and an option to discard it

### Story: Evaluate a prompt
**Given** a saved prompt with at least one eval case
**When** the user runs the evaluation
**Then** each case runs against the current template and the run history records its version, per-case result, and aggregate score or pending manual rating

### Story: Generate an eval set with AI
**Given** a saved prompt with room below the 20-case limit
**When** the user requests AI-suggested eval cases
**Then** the app presents editable happy-path, edge-case, and adversarial proposals that remain unsaved until individually accepted

### Story: Compare evaluation runs
**Given** a prompt with at least two completed evaluation runs
**When** the user selects both runs for comparison
**Then** the app aligns matching cases and shows their outputs, criteria, rationale, scores, and run-level model, latency, token, and cost differences

### Story: Accept an AI refinement
**Given** a saved prompt and answers to the refinement questions
**When** the user accepts the proposed revision shown in the diff
**Then** the revision becomes the current prompt and the previous content remains available in version history
