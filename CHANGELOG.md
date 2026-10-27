# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, the public API and data model may change in
any release. See [Project status](./README.md#project-status).

## [Unreleased]

Prepared for 0.11.0; see the [release candidate](./docs/releases/0.11.0.md).

### Added

- AI answers in Test with AI and in Evaluate render as Markdown, with tables, lists, headings and
  emphasis, and a Plain text button shows the exact text. Raw HTML is not rendered, images show
  as their alt text, and links open in a new tab.

### Fixed

- Settings suggests a local Ollama or vLLM address only when the server allows private addresses,
  reported by the connection response's new `private_urls_allowed` field. A refused private
  address explains that a model on your own computer cannot be reached from a hosted server,
  and tells self-hosters about `ALLOW_PRIVATE_LLM_URLS=true`.
- The filled preview no longer crashes on an input named `__proto__` or goes blank on one named
  `constructor`.
- When a prompt was saved somewhere else while you edited it, the notice offers Compare, Keep my
  edits and Use the saved version. Compare shows the saved version against yours word by word,
  says when input settings differ too, and Keep my edits keeps what you compared.
- History keeps focus, so Escape still closes it, after marking a version as known good.
- A required input is flagged only after you have been in it, a collapsed Options for <name>
  says when the input is required, and its example and choices fields have labels.
- Sign-up states the username rules (3–50 letters, numbers, underscores or hyphens) and checks
  them before submitting, as Settings does; changing the password confirms with a status message.
- The sign-in page is headed "Sign in", its wordmark links back to the home page, and Sign out
  everywhere asks for confirmation first.
- A search inside a folder or Favourites that finds nothing offers Search all prompts. Search
  excerpts are cut at word boundaries and keep `{{variables}}` whole.
- More-actions menus move with the arrow keys, Home and End, and the JSON export's file name
  carries the date.
- The error page leads back to the library instead of the retired dashboard, the guides use
  the current button names (Edit template, Options for <name>) and point to Settings for
  ChatGPT and Claude, and the free refiner says it is checking availability instead of showing
  nothing.
- Word diffs merge neighbouring changes and keep a gap between a removed word and its
  replacement, so swaps read clearly.
- Placeholder text, including the library search, uses the themed muted colour, so it stays
  readable in dark mode; dropdowns and expandable sections show the same focus ring as buttons.
- Library card previews show a Markdown link as its text instead of the address, and Evaluate
  gives its saved test cases a heading for screen readers.
- On touch screens, buttons, toggles, inputs and the small text links are at least 44px tall.
- Settings descriptions wrap at a readable width, and its status and field labels are larger.
- Section cards, error notices, history and Evaluate drop their coloured left stripes for full
  borders or tinted backgrounds.
- With reduced motion, loading spinners pulse instead of freezing, and notices fade without
  sliding. The full-page loading spinner turns again.

### Security

- The backend's `dnspython` is updated from 2.8.0 to 2.9.0 for CVE-2026-114605: a crafted DNS
  message could make name decompression use excessive CPU. It is only pulled in by
  `email-validator`, which the app uses without DNS lookups. Rebuilt images pick it up; no
  configuration change.

## [0.10.0] - 2026-10-24

See the [release record](./docs/releases/0.10.0.md).

### Added

- Inputs can offer a list of choices: add them one per line in the input's options, and Fill
  mode shows a list to pick from (for example an art style or a character). Choices are kept in
  versions and JSON exports and returned by the ChatGPT and Claude `get_prompt` tool.
- Free prompt tools at `/tools` that work without an account and upload nothing: a template filler
  for `{{variables}}`, a prompt checker, a word-level prompt diff and a token counter with
  estimated costs. Each can save its prompt to your library after you sign in or sign up. The
  app's sidebar, the editor's starter templates and the empty library link to the tools and the
  gallery.
- Four new guides: what makes a good AI prompt, prompts for coding agents, image generation
  prompts, and prompts for research and writing.
- A free prompt template gallery at `/gallery`: 24 curated templates for coding agents, image
  generation, research and writing, and everyday work, to fill in, copy or save to your library.
- A free AI prompt refiner at `/tools/prompt-refiner` for visitors without an account, off by
  default. Operators enable it with `PUBLIC_REFINE_ENABLED=true`; it runs on the server-default
  connection with per-visitor, daily and monthly limits (`PUBLIC_REFINE_RATE_LIMIT`,
  `PUBLIC_REFINE_DAILY_LIMIT`, `PUBLIC_MONTHLY_BUDGET_USD`; by default 6 requests a minute and 30 a
  day per visitor, so a few question-and-draft rounds fit in a minute) and can use another model on the same
  provider (`PUBLIC_REFINE_MODEL`). "Improve now" fills in an audience, format, length and how to
  handle missing information. Migration 033 adds its spend ledger.

### Fixed

- Library polish: the bulk action bar stays in view while selecting further down the list;
  previews of imported notes no longer show Markdown such as ``` or `###`; Undo after deleting
  lasts 10 seconds; the search is kept in the address (`?q=`), so Back from a prompt keeps it;
  and a prompt with unsaved edits in this browser is marked Unsaved draft.
- Settings and the account stay in view at the bottom of the sidebar however many folders there
  are, and Guides, Free tools and the Template gallery are marked as leaving the app.
- The browser tab says "Sign in" or "Create account" instead of the last page's title, and
  Settings warns when the ChatGPT and Claude server address is local or not HTTPS.
- Insert input turns a name such as `max rows!` into `max_rows`, and its error sits on its own
  line instead of squeezing the name field.
- Inputs filled in before a new prompt's first save are kept after saving.
- Opening a prompt that does not exist says "Prompt not found" instead of "Failed to fetch
  prompt versions", and signing up with an unusable email domain says "Enter an email address you
  can receive mail at." instead of the validator's technical text.
- History on narrow screens is a dialog: Escape closes it, focus stays in it after Restore, and
  restore results and errors are shown inside it (a failed restore keeps the comparison).
- Make reusable with AI goes straight to the AI conversion instead of asking again; the review
  opens on Template when no input has a value yet.
- Editor polish: italic hints in Fill mode, a clearer example-value label, a warning when Try once
  would run with no inputs filled in, an aligned Mark as known good button, and Prompt details now
  shows created and edited dates, the current version, the known-good version and the inputs.
- Re-importing a changed note and choosing Update no longer turns inputs made on the first
  import back into placeholder text: `{{focus_area}}` stays an input with its settings, and only
  new placeholders are offered.
- Re-import compares a note with every library prompt of the same title, so a prompt that
  shares its title with another is no longer flagged as changed, and Update is offered only
  when exactly one prompt has that title.
- Obsidian note templates (Templater, `{{date:…}}`, the Templates folder) and pages that only
  link to other pages start unticked, with the reason shown.
- Links to other Notion pages, such as `[Style guide](Style%20guide%20b2c3….md)`, are imported
  as their text, and a nested tag such as `#prompts/engineering` suggests the folder
  "Engineering" rather than a folder named with a slash.
- When pasted text starts with the line used as its title, the preview offers to take that line
  out of the text; it is never removed automatically, since a title and an instruction look alike.
- Import messages are plainer: "Imported 7 prompts, skipped 1 already in your library", ignored
  files are named, an empty note says "This note is empty", and each prompt's tick box is
  labelled with its title.
- Suggested test cases no longer repeat or rephrase the prompt's existing cases.
- Refine no longer drops clarifying questions that mention an input such as "the article",
  which could leave a vague prompt with no questions at all.
- Saving right after loading a page could fail with "Missing or invalid CSRF token": the
  session refresh started by the first click replaced the token a save in flight was using.
  Refreshing now keeps the token.
- Splitting a section over 10,000 characters (when importing notes, or saving from a free tool)
  no longer cuts through a `{{placeholder}}` or an emoji.
- A variable named like a built-in property, such as `{{constructor}}`, is no longer filled in
  with stray text in the preview.

### Changed

- The app uses British spelling throughout: the Favorites view is now Favourites.
- Public pages (landing page, guides, tools, gallery, legal pages) follow your system's light or
  dark setting until you choose a theme; the app itself stays light by default.
- Registration is open by default. Operators who relied on the implicit closed default must now
  set `REGISTRATION_MODE=closed`, which still admits only the first account; any unrecognised
  value is also treated as closed.

### Security

- The backend's `opentelemetry-api` is updated from 1.45.0 to 1.45.1 for CVE-2026-114603: an
  inbound `tracestate` header could make parsing take quadratic time and stall a worker.
  Rebuilt images pick it up; no configuration change.

## [0.9.0] - 2026-10-20

See the [release record](./docs/releases/0.9.0.md).

### Added

- AI-reviewed evaluation results can be rated with your own 1–5 stars. Your rating is
  kept beside the AI score without changing it, and Run history shows how often the AI
  review agreed with you (within one star).
- Evaluations remember the exact prompt text they tested. Run history no longer asks
  you to rerun a prompt whose current text was already tested (for example after
  restoring a version). The API can also evaluate unsaved sections, shown as "Unsaved
  draft" until the same text is saved.
- Mark one version of a prompt as known good from History. History also shows each
  version's newest test result, Evaluate labels runs of the known-good version, and
  library cards say "Tested · 82/100" or "Tests out of date" for prompts you evaluate.
- Claude can use your library as a custom connector, the same way ChatGPT does: add
  `<your site>/api/mcp` under Customize → Connectors in Claude (any plan) and the AI
  work runs on your own Claude subscription. Settings → ChatGPT and Claude shows how.
  `OAUTH_REDIRECT_HOSTS` now defaults to `chatgpt.com,claude.ai`; if your `.env` sets it
  explicitly (older `.env.example` files set `chatgpt.com`), add `claude.ai` there.
- Refine can use your test results: choose up to five results from the latest evaluation
  and the draft aims to improve on them. After reviewing a draft of a saved prompt, Check
  against test cases runs your cases on the draft (and on your current prompt, unless it
  was already tested) and compares the outputs side by side before you apply anything.

### Changed

- Importing a note again can update its library prompt when the text changed, saving
  the earlier text in History; leaving it as it is stays the default, and the dialog and
  landing page say importing is a one-time copy. Closing the dialog keeps an unfinished
  preview, and reopening offers Start over. Notes directly in a chosen folder start
  Unfiled instead of being filed under the folder's name.
- Add existing prompts previews and imports up to 1,000 prompts at a time, with
  progress, instead of refusing more than 100. Each prompt has a tick box, so templates
  and other notes can be left out, with Select all new and Select none.
- A note with a title over 100 characters or a section over 10,000 characters is
  previewed with what to change instead of skipped; a long section can be split into
  numbered sections without losing text. Skipped files are listed with plain reasons,
  errors stand out, a title repeated within one import is flagged, placeholders show how
  many prompts use them, and the folder picker says "Choose folder".

### Fixed

- Imported notes are no longer skipped for headings with list numbers, punctuation,
  accents or repeats (`## 1. Role`, `## Step 2: Draft`, a second `## Example`); these
  become valid section names instead.
- A database CSV in a Notion zip or chosen folder is read unless its rows were also
  exported as pages, so an export without subpages no longer loses every row. A split
  export's part names are no longer suggested as folders, and a CSV row's Favourite
  status is kept.
- Imported notes also drop Obsidian `%% comments %%`, Dataview queries and embedded files,
  read `==highlights==` as text, and drop Notion `<aside>` callouts. Windows line endings
  no longer offer "Keep the original note text" for an untouched note, several files
  preview in folder order, and a Notion HTML export explains how to export Markdown & CSV.

### Security

- The backend's `certifi` CA bundle is updated to 2026.10.19 for
  [GHSA-6q48-6c7w-9gw2](https://github.com/advisories/GHSA-6q48-6c7w-9gw2): earlier
  bundles trust a root whose intermediate CAs had compromised keys. Rebuilt images pick
  it up; no configuration change.

## [0.8.0] - 2026-10-19

See the [release record](./docs/releases/0.8.0.md).

### Changed

- Add existing prompts accepts several files at once, a whole folder (such as an
  Obsidian vault, skipping hidden folders like `.obsidian` and non-note files), or
  files and folders dropped onto the dialog. They share one preview; each note's
  folder is suggested from its parent folder, Notion page IDs are dropped from
  file-name titles, and files without prompts are listed as skipped.
- Imported notes drop Notion page properties, Obsidian callouts and trailing `#tags`,
  and read `[[links]]` as text, under the same "keep the original" choice as front
  matter. The first tag suggests the folder, a Notion favourite stays a favourite, and
  a pasted page that starts at `##` uses that heading as its title and splits on it.
- The placeholder offer lists each placeholder with a checkbox, never includes
  `[[wiki-links]]`, and keeps each placeholder's wording as its input's hint
  (`[PASTE CODE HERE]` becomes an input hinted "Paste code here").
- A note without a title is named from its first line instead of "Imported note".
- Notion's Markdown & CSV `.zip` export can be imported as downloaded (read in the
  browser, including nested part zips), and a database `.csv` becomes one prompt per
  row with Tags as its folder. A Notion property that holds the prompt text is kept;
  only metadata lines are removed. Binary files are refused instead of imported as text.
- Importing skips prompts whose title is already in the library, including ones imported
  earlier in the same session, unless "Import a copy anyway" is ticked, and selected
  library prompts can be deleted together with one Undo.
- Settings has a ChatGPT section: the connector address to copy, the steps to connect,
  and the connected apps, each with Disconnect (`GET`/`DELETE /api/auth/me/connected-apps`).
- Make reusable with AI leaves out notes meant for the prompt's owner, such as which
  AI tool to use, reminders, tags or links to other notes, instead of making them sections.
- The empty library leads with Add existing prompts and says it takes Notion,
  Obsidian and Markdown notes; New prompt sits beside it.
- Library grid cards show the variable count like the list, and card snippets
  prefer the Task section over a shared role line.
- Save as written suggests a short title from the first line, without `{{variables}}`.
- History and evaluation run times show the time zone. Example inputs are multiline,
  full folder names appear on hover in the sidebar, and the editor title shows a
  rename icon. The Variables panel drops its unrelated travel example.
- AI actions say whether they use your own connection, billed by your provider, or
  this server's shared connection, paid for by the operator. `/api/prompts/config`
  adds `uses_server_default`.
- Saved prompts with variables open ready to fill from anywhere, with Edit template
  for wording changes. Filled inputs are kept on this device for every saved prompt
  until cleared, and the preview says so.
- The library has one **Add existing prompts** entry point for pasted text and files,
  replacing the separate Paste a prompt link and Import prompts button. The dialog
  folds format details away, shows section text for small imports, offers Make
  reusable with AI for a single note, and ends with Open imported prompts or Import
  more. Favorites in a JSON export carry over.
- Inputs, selects, text areas and secondary buttons use a control border that meets
  3:1 contrast on every surface in both themes, including the preview's fill-in
  fields. Editor section cards mark their text area with a 3:1 left rail, and focus
  outlines the whole card in both themes. Decorative borders and dividers are unchanged.
- Each section has an Insert input control: name an input to add it at the caret, or
  select text first to turn it into an input that keeps the text as its example.
- Importing a note removes its YAML front matter and reads the rest as Markdown, so
  a leading `# Title` becomes the title and `##` headings become sections. The
  preview can keep the original text instead. Make reusable with AI receives the
  note's body without front matter or its title line.
- The import preview offers to turn placeholders such as `[TOPIC]`, `{audience}` or
  `<transcript>` into inputs, with Undo, and adds a Folder for all prompts field when
  several prompts are imported. The file picker matches the app's buttons.
- Prompts with a single section copy as plain text by default, in the preview and from
  the library; Output options or the library menu add the section tags.

### Fixed

- The import preview's buttons wrap on phones instead of pushing "Keep as written"
  off-screen, and a file's name is no longer reused as the title of text pasted
  afterwards.
- Registration shows the password rules under the field while typing, Try once
  scrolls its output into view, and deleting an account ends on the sign-in screen
  with a confirmation.
- Undoing a pasted conversion no longer reopens its review dialog when you return
  to the prompt; only a Paste dialog left open is recovered.
- Section text no longer shrinks to its first line after switching from Fill and
  copy to Edit template; text areas also refit when their width changes.
- The sidebar's New prompt button keeps its size when many folders make the
  sidebar scroll.
- A Try once output no longer squeezes the fill-in fields out of the preview, and
  it has its own Copy output button.
- Disconnecting an AI provider asks first, says the API key will be erased and what
  AI features fall back to. While your own connection is used, Settings names the
  server's shared connection that would replace it.
- Provider errors point to Settings → AI connection (the section's real name) and
  link to it. Refine no longer claims a shared connection is your own, Settings
  lists every AI feature, and its data note says imports keep favorites.
- A single unfilled input reads "It'll be copied as a placeholder", and Evaluate
  says "Runs 1 case" instead of "Runs all 1 case".
- Make reusable with AI no longer fills inputs with placeholder text such as `[TOPIC]`;
  they start empty. AI-created sections use readable names (`Output format`, not
  `output_format`) and the title is no longer turned into a section.
- The title and folder chosen in the library's import preview carry through Make
  reusable with AI into the Save dialog, and applying the conversion no longer leaves
  an outdated "Your unsaved changes were restored" notice next to the import notice.
- Library search matches every word in any order across titles, folders and sections
  ("email refund" finds "Refund Request Template"), and ignores extra spaces.
- Refine offers Improve without questions, for a draft that tightens the wording
  without new requirements; `POST /api/prompts/refine/draft` accepts no `qa_pairs`.
  Its questions no longer ask what a `{{variable}}` should be, and an applied draft
  stays in the panel so it can be applied again after Undo without another AI call.
- Library cards are wider, so titles and all card actions fit on fewer lines, and
  snippets mark `{{inputs}}`. The List/Grid toggle now saves the "Library opens as"
  setting. The search field's clear button uses the app's colours.
- Insert input turns a name with spaces into an input name (`Target audience` becomes
  `target_audience`) instead of rejecting it.
- Version history dates each version by when it was written rather than when a later
  save replaced it.
- Suggested evaluation cases favour realistic inputs and add an adversarial case only
  for prompts that handle text from other people. The empty-state text hides while
  suggestions are shown.
- The landing page mentions importing Markdown notes from Notion or Obsidian, and its screenshots and
  the documentation screenshots show the current app.

## [0.7.0] - 2026-10-18

### Added

- Serve operator-supplied Terms of Service at `/terms` and show its legal link
  when `nutzungsbedingungen.html` is available in the mounted legal directory.
  See the [release record](./docs/releases/0.7.0.md).

## [0.6.1] - 2026-10-17

### Fixed

- MCP tools explicitly declare all three safety annotations. Updating an existing
  prompt is marked as destructive because it replaces current content, even
  though previous content remains in version history. New prompt saves remain
  additive. See the [release record](./docs/releases/0.6.1.md).

## [0.6.0] - 2026-10-17

Library imports, prompt reuse, curated AI connections and UX fixes. See the
[release record](./docs/releases/0.6.0.md) and **Upgrade notes** before deploying.

### Added

- Paste prompts without AI using Save as written, with an editable suggested title.
- Preview JSON or Markdown collection imports, edit titles and folders, and retry failed items.
- Sort the library by title or content recency and file selected prompts together.
- Choose Light, Dark or System from the sidebar or Settings.
- Configure an optional Anthropic workspace ID for multi-workspace keys; shared
  AI requests send it only to Anthropic's endpoint (migration 029).
- Choose plain-text output in the editor or copy plain templates from the library.
- Import single notes using filename, editable or simple front-matter titles.
- Build automatic evaluation checks with Contains, Does not contain and Valid JSON.
- Open Guides from the app and view complete prompt names through Prompt details.

### Changed

- Hosted AI connections use curated model choices with display names and estimated
  prices. Local and custom providers retain discovery and manual model entry.

### Fixed

- Editor panes switch to tabs before they overlap on tablets and small laptops;
  Fill and copy links open a focused reuse view on every screen size.
- Discarding template edits preserves filled inputs for retained variables, and
  recovered drafts are explained above both panes. Inputs have a separate clear action.
- Library metadata has its own row, frequent icon controls have larger targets,
  and favoriting or filing no longer changes content recency.
- AI connection checks show a loading state. Budget rejections explain the limit's
  scope and reset time, retain test cases, and offer an explicit availability recheck.
- Evaluation distinguishes failed and partially failed runs from pending ratings,
  hides legacy raw provider errors, and offers safe, actionable connection guidance.
- Search results identify and highlight matching passages, including later sections.
- Mobile mode controls no longer repeat Fill and copy; tabs and title controls
  have larger targets. Advanced variable settings are collapsible and markup
  advice can be dismissed without changing the prompt.
- Export wording distinguishes a full data archive from importing prompt copies.

### Upgrade notes

- Saving an OpenAI, Anthropic or Gemini connection now requires a model from the
  curated catalogue (HTTP 422 otherwise). Existing older models remain readable,
  testable and runnable until the connection is changed; updating it requires a
  current choice. Saved API keys can be retained, and server defaults are unaffected.
- Migration 028 adds a content-edit timestamp. Historical rows retain their last
  known update time; earlier organization-only activity cannot be reconstructed.
- Prompt responses add `content_updated_at`. AI capability responses include caller
  budget status; budget errors retain `detail` and add recovery metadata.
- Migration 029 adds optional per-user `llm_workspace_id`. Existing connections
  remain unchanged; multi-workspace Anthropic keys can configure it in Settings.

## [0.5.1] - 2026-10-16

0.5.1: dark-mode and editor polish, and fixes from the UI and UX
review. Frontend only, with no database migrations or API changes. See the
[release record](./docs/releases/0.5.1.md).

### Added

- The sidebar links to the source code on GitHub.
- The landing page shows a worked example of a template being filled in.

### Changed

- Dark mode uses near-neutral surfaces with clearer steps between them, keeps
  plum for the sidebar, selected states and the preview, and softens coral.
  Both themes share one layout, so switching theme never moves content.
- On a saved prompt, Evaluate, Paste a prompt and History sit in the editor's
  Tools menu, and Try once sits in a collapsible Test with AI panel.
- Copy with placeholders appears only while required inputs are missing.
- The library, folder and Starter templates menus are plain lists of buttons.
  Escape closes them and returns focus to the button that opened them.
- Settings calls the AI import feature Paste a prompt, matching the editor.
- Developer, API, operations, product and agent documentation is synchronized
  with the current codebase, with a documentation index and explicit separation
  of implemented features, backlog work and historical records. Documentation
  screenshots and public guide instructions reflect the current controls.

### Fixed

- A saved dark theme now applies before the first paint on every page, including
  sign-in and the landing page, and native controls follow the active theme.
- Dark mode no longer shows a bright GitHub button, brown disabled primary
  buttons, sunken selected segments or muddy history diff highlights. Optional
  preview notes are muted instead of coral.
- The sidebar and the editor preview stay in view while the page scrolls.
- The library grid no longer cuts off card actions in narrow windows; it keeps
  one column until two whole cards fit.
- Closing a dialog returns focus to the control that opened it. A Paste a prompt
  dialog opened from a link returns focus to the Paste a prompt button.

## [0.5.0] - 2026-10-15

0.5.0: application observability, account security, public practical guides,
and reliability and accessibility fixes. See the
[release record](./docs/releases/0.5.0.md) and read **Upgrade notes** before deploying.

### Upgrade notes

- Back up and rehearse the upgrade on an isolated copy. Startup migration
  `026_user_auth_subject` assigns immutable UUID identities to existing accounts.
  Users must sign in again. Migration `027_oauth_grants` invalidates legacy OAuth
  codes and tokens; MCP OAuth clients must reauthorize using their existing
  registrations.
- New passwords are limited to 72 UTF-8 bytes. Legacy passwords over that limit
  are rejected safely during verification and need a password reset.
- Private URLs for user-configured Ollama/vLLM connections now follow the same
  policy as custom URLs. Use an operator-managed server default for a trusted
  local provider, or deliberately enable `ALLOW_PRIVATE_LLM_URLS=true`.
  Public-only connections disable redirects and environment proxies.
- Update Compose, scripts and monitoring provisioning files together. Grafana
  now needs `scripts/grafana-entrypoint.sh` and refuses an empty or published
  placeholder admin password. Backend logs are JSON; custom log parsers and
  queries using the old application counters need updating.
- Evaluation history now defaults to 50 runs. API clients needing older runs
  must page with `limit` (maximum 100) and `offset`.
- New, reset and changed passwords need at least 10 characters, a number and a
  special character. Existing passwords keep working until changed.
- `PATCH /api/auth/me` requires `current_password` when it changes the email
  address. Active browser sessions now end at most 12 hours after sign-in.
- The provider SDK now uses HTTPX2 and the operating-system CA trust store.
  Deployments with custom provider CAs should install them in that trust store;
  TLS hostname verification and the public-IP transport protections remain enabled.

### Added

- Optional App Overview, AI & Evaluation and API Health Grafana dashboards,
  provisioned alerts and Prometheus rules for application operations, provider
  attempts, evaluation outcomes and current database totals. See
  [monitoring](./docs/monitoring.md) for event meanings and retention limits.
- Structured backend logs with request IDs, bounded operation/error fields,
  migration progress and server lifecycle events, excluding sensitive request
  content, IP addresses and provider error text.
- `make monitoring-check` validates Prometheus syntax and semantic fixtures in
  local CI and the required GitHub Compose validation job.
- Sign in with either the username or the account email.
- Changing the recovery email notifies the previous address.
- Public practical guides for reusable prompts, template variables and organizing
  a ChatGPT prompt library, with worked examples, related articles and app links.

### Changed

- Keyboard and pointer activity renews the browser session, so working users
  are no longer signed out after a fixed 30 minutes; idle tabs still expire.
  Renaming the username keeps the session instead of signing out.
- Application telemetry uses `pms_*` metrics in place of the previous signup,
  login, prompt-save, AI-import and password-reset-email counters. REST and MCP
  mutations share an operation boundary; provider attempts remain separate.
- Release images are uploaded without release tags, scanned by immutable digest,
  then promoted to release tags with their provenance and SBOM intact.
- Include the frontend, backend and backend-major Dependabot update groups:
  Next.js/ESLint 16.4.1, OpenAI SDK 3.13.0, SQLAlchemy 2.1.3 and updated test,
  audit and dependency tooling. The custom provider transport moves to HTTPX2,
  retaining DNS/IP pinning, redirect restrictions and TLS identity checks.

### Fixed

- OAuth client revocation immediately blocks existing MCP access tokens and
  invalidates pending codes and refresh tokens for that account/client pair.
  Global sign-out, password changes and resets reject earlier pending approvals
  and in-flight refresh exchanges. Token issuance preserves the validated
  account version, and overlapping revocations advance it atomically. Delayed
  client revocation cannot disconnect reauthorized clients or replacement accounts.
- Session and MCP tokens cannot follow reused usernames or numeric account IDs.
  Registration uses a generic duplicate-account response, unknown-user login
  checks a dummy bcrypt hash, and insecure signing keys are rejected before
  database initialization.
- Public provider connections validate DNS answers for each request and connect
  to those exact public IPs while preserving TLS hostname verification.
- Failed AI parsing, validation and retry attempts retain reported spend;
  successful retries are billed once. Evaluation workers retain completed usage
  and defer database writes until provider work finishes. Non-finite judge
  scores are handled as failed judgments.
- Pricing refreshes no longer block concurrent callers behind the network lock;
  failed refreshes back off while stale/fallback pricing remains available.
- Backups publish private archives atomically. Restores preserve ownership and
  permissions, retain committed WAL data in the pre-restore snapshot, reject
  active database users and prevent stale WAL replay.
- Migration 020 preserves the legacy note schema so migration 025 backfills it
  on upgrades crossing both steps. Previously damaged note history still needs
  review against a verified backup.
- The session countdown follows the renewed session after a password change
  instead of signing out at the old expiry.
- Sign-out waits for pending activity refreshes before clearing cookies, so a
  delayed response cannot restore the session. Short configured sessions renew
  before expiry while users keep working.
- Transient session-check failures can be retried. API validation errors display
  readable messages; saving remains successful when a later history refresh
  fails; evaluation history stays usable when AI configuration loading fails.
- Evaluation history loads in pages, the mobile sidebar traps/restores focus
  and excludes closed content from navigation, success feedback is announced,
  and oversized section content is rejected inline before saving.
- Buttons changing variants no longer briefly pair the previous background
  with the new text color, fixing a contrast failure caught by the updated
  accessibility checker.
- Local scans and Compose validation work in linked worktrees without opening
  the operator environment file; one-off SQLite and Trivy images are pinned.

## [0.4.0] - 2026-10-14

0.4.0: a public landing page, so search engines and new visitors see what
Prompt Maker Studio does. Read **Upgrade notes** before deploying.

### Upgrade notes

- Update `docker-compose.yml` on the server along with `IMAGE_TAG`. The frontend
  service now receives `FRONTEND_URL`; with the old Compose file, `robots.txt`,
  the sitemap and canonical links point to `http://localhost:3000`. Check that
  `.env` sets `FRONTEND_URL` to the public origin.
- No database migrations.

### Added

- A public landing page at `/` describing the product, with `robots.txt`,
  `sitemap.xml`, a canonical link and social previews built from `FRONTEND_URL`.
  Signed-in visitors are sent straight to the library, which now lives at
  `/library` only; the frontend container now receives `FRONTEND_URL`.
- `server.json` describing the hosted MCP endpoint for the official MCP Registry.

### Fixed

- The production frontend image now includes `public/`, so the PWA icons and
  landing screenshots load instead of returning 404.

## [0.3.0] - 2026-10-13

0.3.0: a library-first sections editor with prompt conversion,
refinement, evaluation and reversible history. Features that were shallow or
misleading for that job were removed. Read **Upgrade notes** before deploying.

### Upgrade notes

- Back up the database first (`make backup-db`) and rehearse the upgrade on a
  copy. Three data migrations run once at startup:
  `023_recover_drifted_prompt_sections` rebuilds the sections of prompts whose
  text was edited by hand, keeping the original sections and text as a version
  noted "Before section recovery"; `024_recover_unnamed_prompts` names old
  History entries (`Untitled (14 Mar 2026, 09:12 UTC)`) and files them under
  "Recovered history". `025_version_notes` associates edit notes with the resulting
  version, keeps original notes in `legacy_note`, and stores the current note
  separately. Recovery snapshot notes stay anchored; older snapshots retain
  current variable settings when restored. Steps in
  [docs/deployment.md](./docs/deployment.md#upgrading-to-030).
- Remove any `make send-weekly-summary` cron entry; the target is gone.
- Breaking API changes: `POST /api/prompts/generate`, `GET /api/prompts/history`,
  `GET /api/prompts/tags`, `POST /api/prompts/{id}/playground/run`,
  `GET /api/prompts/{id}/playground/runs` and `GET /api/analytics/dashboard` are
  removed. `PATCH /api/prompts/{id}` rejects `generated_prompt` and `tags`.
  Prompt responses no longer include `tags` or `run_count`, and the profile no
  longer includes the `notify_*` preferences.
- MCP clients should refresh their tool schemas: `list_saved_prompts` lost its
  `tag` filter and `tags` output. See [docs/mcp.md](./docs/mcp.md#contract-changes-in-030).

### Added

- Paste a prompt from the library or editor: convert unstructured text into
  XML-style sections and reusable variables with verbatim original values.
  Review Filled or Template output, rename variables, keep an input fixed,
  copy immediately, or apply to the draft with Undo. Source text, review edits
  and converted inputs recover locally; inputs become saved examples only by
  explicit choice. `parse-text` variable extraction is opt-in, so existing
  fields-only API callers remain compatible.
- Required and optional variables, missing-required-input feedback, explicit
  Copy with placeholders, and prompt-specific examples loaded on request.
  Existing variables stay optional by default.
- A compact Try once action uses the filled prompt and configured AI connection,
  with loading, output, errors and billing context. `POST /api/prompts/try`
  records spend without saving a prompt or creating Playground history.
- Evaluation workspace for saved prompts: readable test-case editing, CSV import/export,
  AI suggestions reviewed before saving, explicit runs, historical outputs and judge
  feedback, run comparison and manual ratings. Uses the existing backend API and
  adapts to phones and both themes.
- Refinement inside the editor: explicit questions, section-level draft review,
  local Apply and Undo, and normal saving. It works with new and unsaved prompts,
  preserves variable hints and filled values, and adapts to a full-screen modal
  on phones. Snapshot API endpoints validate section and placeholder preservation;
  existing saved-prompt refinement endpoints remain compatible.
- One editor for new and saved prompts: named sections you can rename, reorder
  and remove, a live preview of exactly what will be copied, Template and Filled
  modes with "Copy template" and "Copy filled prompt", variable hints, inline
  warnings for empty sections and unevenly opened tags, starter templates, and
  Paste a prompt.
- Explicit saving with Ctrl/⌘+S and an optional version note, local draft
  recovery, an edit-conflict banner that keeps your edits, and a History panel
  with a word-level diff and undoable restore.
- `POST /api/prompts` to save a prompt from its sections. Section names may
  contain spaces; the tag replaces them with underscores (`<OUTPUT_FORMAT>`).
- The library as the home page, with a sidebar of favorites and folders with
  counts; `PATCH` and `DELETE /api/prompts/folders?name=` rename (merging) and
  remove folders without deleting prompts.
- Phone layouts: a sidebar drawer, and an editor that opens saved prompts on a
  Fill and copy tab.
- A new look: coral and plum, Hanken Grotesk and JetBrains Mono (self-hosted),
  light by default.

### Changed

- The server renders a prompt's text from its sections on every write, including
  restores and MCP updates, so the web app, the ChatGPT plugin and the copied
  text always agree.
- Settings is one page with section navigation: profile, password and sessions,
  theme, library layout, the optional AI connection, export, and account deletion.
  Discovered models are grouped by likely text-generation compatibility;
  self-hosted custom model entry remains available. Connection-test success is
  distinguished from selected-model compatibility.
- Library cards expose Fill and copy alongside Copy template. Section actions
  remain visible on phones, with accessible labels and 44-pixel touch targets.
- AI-backed actions show the configured provider/model and provider-charge
  context. Refinement Apply explicitly updates the draft; Save persists it.
- Evaluation results show tested and current saved versions and offer Run current
  version while retaining historical results.
- Backend services, schemas, routes and migrations, and frontend feature UI,
  controllers and API transport are reorganised around existing responsibilities.
  Shared REST/MCP services and section-rendering fixtures protect their contracts.
- The demo seed matches the new model: folders, hints, version histories, and no
  Playground runs or tags.
- Version metadata in `package.json`, `pyproject.toml` and the API is now
  consistent with the release number.

### Removed

- The Generate step and History tab, the dashboard and analytics, the standalone
  Playground screen, tags, code-snippet export, the compile animation, the output
  metrics bar, the density setting, variable type pickers, and all notification
  emails including the weekly summary. Old `/dashboard` and `/playground/{id}`
  links redirect.
- The `prompts_generated_total` and Playground Prometheus counters and their
  Grafana panels.

### Deprecated

- Automatic evaluation after saving remains disabled. The stored evaluation
  preferences remain inactive; runs start explicitly in the Evaluate workspace.

### Fixed

- Save notes now describe the resulting version, including the current version;
  original legacy notes remain available in history and JSON export.
- Text import stages a review before replacing draft content and offers Undo.
  Applying a library conversion consumes its one-time URL flag so reload opens
  the recovered filled prompt instead of an empty import dialog.
- Conversion validates original values, section tags and placeholder records;
  malformed responses leave the source intact, and validation logs omit source
  text. Completed invalid calls still count toward provider charges.
- Regex evaluation uses fork-server workers so it remains safe when checks run
  from evaluation threads.
- Dialogs no longer move focus back to their first field on every keystroke.
- Times from the API, which are UTC without a zone marker, are no longer read as
  local time.

## [0.2.0] - 2026-10-07

### Added

- MCP endpoint at `/api/mcp` exposing the saved-prompt library as tools (list,
  get, save, update, version history) for ChatGPT and other MCP clients. It
  accepts the existing bearer token. See [docs/mcp.md](./docs/mcp.md).
- OAuth 2.1 account linking for MCP clients: dynamic client registration,
  PKCE, a consent page at `/oauth/authorize` with sign-in and sign-up, and
  rotating refresh tokens. Linked clients are disconnected by "Sign out
  everywhere", password changes, and account deletion. New
  `OAUTH_REDIRECT_HOSTS` setting (default `chatgpt.com`). Requires migration
  `022_oauth_tables` and a new Caddy route for `/.well-known/oauth-*`: back up
  the database before upgrading, and recreate the Caddy container
  (`docker compose -f docker-compose.yml up -d --force-recreate caddy`), which
  does not reload its `Caddyfile` on its own.
- Rate limits on the OAuth registration, token, revocation, and consent
  endpoints (`OAUTH_REGISTER_RATE_LIMIT`, `OAUTH_TOKEN_RATE_LIMIT`), and the
  `offline_access` scope so ChatGPT relies on refresh tokens. Step-by-step
  ChatGPT connection guide in [docs/mcp.md](./docs/mcp.md).

### Changed

- uvicorn upgraded from 0.27.0 to 0.54.0, required by the MCP SDK.

### Fixed

- The Grafana dashboard showed no data: its panels referenced a data source
  uid that the provisioning never set. Existing Grafana volumes are migrated
  on the next start. The "Rate-Limited Requests" panel, which could never match
  the grouped status codes, now shows all 4xx responses, and the "Active
  Requests" panel, which plotted a timestamp, is removed.

### Security

- `source-map-js` updated from 1.2.1 to 1.2.2 in the frontend image
  (CVE-2026-93749, denial of service via malformed indexed source maps).

## [0.1.4] - 2026-10-04

### Added

- Optional server-default LLM (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`,
  `LLM_PROVIDER`) for users who have not connected their own provider. A
  user's own connection still takes precedence.

## [0.1.3] - 2026-10-04

### Fixed

- The scheduled backup failed with `unable to open database file` when it ran
  while the backend was stopped — for example during `docker compose up` after
  an upgrade, or after a reboot — and then waited a full interval before trying
  again. The read-only mount cannot recreate SQLite's WAL `-shm`/`-wal` files.
  The worker now starts only once the backend is healthy, retries every 60
  seconds until a backup succeeds, and its logs are size-capped like the other
  services. (#38)

## [0.1.2] - 2026-10-04

### Added

- **Operator-supplied legal pages.** `/impressum` and `/datenschutz` render HTML
  fragments from a folder mounted read-only into the frontend
  (`LEGAL_PAGES_PATH`, default `./legal`). Links appear in the app footer and on
  the sign-in screen only for pages whose file exists; deployments without the
  files are unchanged. See "Legal Pages" in `docs/deployment.md`. (#36)
- Scheduled backups older than `BACKUP_RETENTION_DAYS` (default 14) are deleted
  after each run, so deleted user data does not survive indefinitely in old
  backups. Manual `make backup-db` runs never prune. (#35)

### Changed

- Container logs for backend, frontend and Caddy are capped at 3 × 10 MB each;
  the backend access log contains client IP addresses. **Operators**: the next
  `docker compose up -d` recreates those containers to apply the limit,
  discarding their current logs. (#35)

## [0.1.0] - 2026-08-09

The first public release. Prompt Maker Studio was developed privately, so this
entry covers the whole of that initial release rather than a delta.

It was preceded by a round of security, licensing, and data-protection
hardening — same-origin API routing, cascading account deletion, an SSRF egress
policy with closed-by-default registration, encrypted per-user provider
credentials, and a full third-party notice inventory. The individual changes are
listed below and in the commit history.

### Changed

- **Renamed to Prompt Maker Studio.** The product name is now shown in the app
  header on every page (previously only in the footer), on the sign-in screen,
  and in browser tab titles, outbound email, and the API's OpenAPI document. A
  single `frontend/src/lib/branding.ts` / `backend/app/branding.py` pair is now
  the source of truth, replacing the name literals that were scattered across
  ~14 components.
- Docker container, image, and network names, the Grafana dashboard, and both
  package names now use the `prompt-maker-studio` slug. **Operators**: the
  Compose project name is explicitly pinned to `prompt-maker` in
  `docker-compose.yml` so the existing `prompt-maker_backend-data` volume — and
  the database in it — is unaffected. Published images move to
  `ghcr.io/<owner>/prompt-maker-studio-{backend,frontend}`.
- Browser storage keys moved from the `prompt-maker:` namespace to
  `prompt-maker-studio:`. Existing entries are migrated automatically on first
  load, so sessions and unsaved drafts survive the upgrade.
- Stored per-user LLM API keys are re-encrypted under a renamed HKDF context.
  Deployments without an explicit `LLM_ENCRYPTION_KEY` transparently fall back
  to the previous derivation on read, so no user has to re-enter their key.

### Added

- **Bring your own LLM provider.** Each user now connects their own provider in
  Settings → API access — OpenAI, Anthropic, Google Gemini, a self-hosted
  Ollama or vLLM server, or any OpenAI-compatible endpoint — with their own
  base URL, model, and API key. Every AI feature (import, Refine, Playground,
  evaluation, eval-case generation, judge grading) runs against that
  connection and is billed by that provider directly. A "Test connection"
  action sends a one-token probe so a wrong key, endpoint, or model name is
  reported in the form rather than as a mystery failure inside a feature.
  See `product/DECISIONS.md`, "Bring-Your-Own LLM Provider over an
  OpenAI-Compatible Transport".
- `LLM_ENCRYPTION_KEY` and `LLM_TIMEOUT_SECONDS` environment variables. Both
  optional: the first defaults to key material derived from `SECRET_KEY`, the
  second to 30s for hosted providers and 180s for self-hosted ones.

### Security

- Per-user provider API keys are stored Fernet-encrypted (via the already
  vendored `cryptography` package) and are never returned by any endpoint —
  only a masked hint such as `sk-…4f2a`. Note that database backups now
  contain encrypted third-party credentials and should be protected
  accordingly.
- A user-supplied provider base URL is a server-side request target. It is
  validated at the boundary (http/https only, real host, no embedded
  credentials, no query or fragment), but private and loopback addresses are
  deliberately permitted so self-hosted inference servers work. The residual
  SSRF exposure on a publicly-registerable instance is documented in
  `SECURITY.md`.

- The backend now refuses to start on **any** signing key this repository has
  published, not just one of them. `.env.example`'s `SECRET_KEY` differed from
  the single value the startup guard compared against, so an instance launched
  from the unedited template booted successfully with a public key — every
  session token on it was forgeable. Keys shorter than 32 characters are
  rejected too, and `make setup` now generates a real key when it creates
  `.env`.
- `backend/scripts/seed_demo_user.py` no longer creates its known-credential
  demo account without `SEED_DEMO_USER=1`, and the deployment guide no longer
  instructs operators to run it against a live instance.
- The deployment troubleshooting guide uses `docker compose config
  --no-interpolate`; the plain form printed every resolved secret from `.env`
  to stdout.

### Changed

- **Breaking: the operator `OPENAI_API_KEY` is gone.** It is no longer read by
  the backend or passed through `docker-compose.yml`. Existing users are
  migrated to an `openai` connection pre-filled with their previous default
  model but **without** a key — the operator's shared credential is
  deliberately not copied into user rows. Until each user adds their own key,
  AI features show a "Connect a provider in Settings" notice instead of
  failing at call time. Remove `OPENAI_API_KEY` from your `.env` after
  upgrading.
- **Breaking:** `GET /api/prompts/config` now requires authentication and
  reports the calling user's own connection. `openai_available` is replaced by
  `provider_connected`, plus `provider`, `provider_label`, and `model`.
- **Breaking:** `default_model` is removed from `GET`/`PATCH /api/auth/me`.
  The model is part of the provider connection now; a second, separately
  validated model preference had no coherent meaning.
- Spend ceilings (`GLOBAL_MONTHLY_BUDGET_USD`, `USER_MONTHLY_BUDGET_USD`) keep
  working but change meaning: users pay their own provider, so these are usage
  guard rails rather than protection for an operator wallet. Self-hosted
  providers price at 0.0, so ceilings never bind for them.
- Cost tracking is keyed by `(provider, model)`; `billed_calls` rows record the
  provider. Unknown pairs still cost 0.0 rather than raising.
- Structured-output handling is now portable. `response_format` is not honoured
  consistently across OpenAI-compatible endpoints (Anthropic documents it as
  silently ignored), so the JSON schema travels in the prompt for every
  provider, `response_format` is layered on only where it helps, and responses
  are parsed tolerantly with one bounded retry.
- Judge grading uses the user's own connection rather than a pinned model, so
  eval scores are not comparable across users with different providers.
- The per-case evaluation timeout derives from the provider's request timeout
  instead of a fixed 90 seconds, so self-hosted runs are not cut short.
- Provider errors are reported with provider-neutral copy naming the user's own
  provider, replacing OpenAI-branded messages like "OpenAI quota exceeded".
- Application version metadata reports `0.1.0`, matching this changelog. The
  Python and npm manifests and the FastAPI app previously advertised `1.0.0`.
- `DATABASE_URL` is documented as applying to non-Docker local runs only.
  `docker-compose.yml` continues to hardcode the container path on purpose:
  the variable's local value is a relative path, which inside the container
  lands outside the persistent volume and starts the backend on an empty
  database.
- Python dependencies are locked transitively in `backend/requirements.lock`;
  local, CI, and container installs all consume it.
- `THIRD_PARTY_NOTICES.md` inventories the resolved runtime dependency sets,
  and both container images carry it alongside the project `LICENSE` and
  `NOTICE`.

### Fixed

- JWT validation now permits at most five seconds of host-clock skew, preventing
  freshly issued sessions from being rejected during a small NTP clock
  correction while keeping issue-time and expiry validation bounded.
- Editor no longer rejects rapid successive edits in a single session with a
  spurious 409 conflict. Prompt mutations are serialized and each one now
  carries the concurrency token from the previous response, so back-to-back
  variable/tag edits both persist. Genuine cross-session conflicts still 409,
  and the conflict banner now offers the Reload action it names instead of
  silently reverting the rejected edit.
- Saving on `/editor/new` regenerates the template when fields changed after
  the last Generate, instead of persisting the stale preview and discarding
  the edit. The preview is also marked stale in the meantime.
- Duplicate field-name validation is case-insensitive, matching the
  upper-cased XML tags the generator emits — `QA_dup` and `qa_DUP` are now
  blocked before submit.
- A Boolean variable left in its default off position counts as `false`
  rather than "missing", and preflight's missing-value check no longer
  disables the Playground's Run button — preflight is advisory everywhere.
- The exported TypeScript snippet uses `replaceAll`, so a variable used more
  than once in a template is substituted at every occurrence.
- The snapshot auto-created when an AI refinement is accepted is labelled
  "Before AI refinement" in version history; historical versions are now
  labelled by their own note rather than the following version's.
- Accepted AI-generated eval cases get a short generated case name instead of
  a mid-word truncation of the proposal's rationale.

### Initial feature set

#### Prompt authoring
- Dynamic field composition — build a prompt from named fields, compiled into
  an XML-tagged template block (`<GOAL>…</GOAL>`).
- Starter kits for common structures: Role–Task–Context, Chain-of-Thought,
  and Persona.
- AI-powered import — paste free-form text and have the connected provider
  decompose it into structured fields.
- Editor with direct template editing, variable metadata and type
  configuration, and version compare/restore.
- Preflight checks flagging unresolved variables, malformed XML, empty
  sections, stale metadata, and oversized prompts.
- Export of Python and TypeScript integration snippets.

#### Running and evaluating
- Playground for executing saved prompts with the user's connected provider
  and selected model, with latency, token count, and cost breakdown.
- Paginated run history with input replay.
- Evaluation suite supporting rule-based, AI-judge, and manual test cases,
  CSV dataset import/export, AI-generated reviewable cases, and cross-version
  output comparison.
- AI refinement flow — clarifying questions, word-level diffs of proposed
  revisions, and acceptance as reversible new versions.

#### Organization
- Library with grid and list views, search, tag filtering, folder
  organization, favoriting, and rename/duplicate/delete.
- Dashboard with usage analytics computed from real runtime data: runs this
  month, average latency, success rate, 7-day request volume, and top prompts.
- Separate paginated, searchable History tab.

#### Accounts and settings
- JWT authentication with registration, login, and sliding session renewal.
- All prompt data scoped per user.
- Password reset over SMTP, with cron-invoked weekly summary emails.
- Settings for profile, UI theme, layout density, evaluation defaults,
  automated evaluation triggers, email notification toggles, and full JSON
  data export.

#### Operations
- Docker Compose deployment behind Caddy with automatic TLS. Caddy is the
  production edge and is excluded from the local development stack, so
  `make up` does not claim host :80/:443 or attempt ACME against a placeholder
  domain; opt in locally with `docker compose --profile caddy up -d`.
- Prometheus and Grafana monitoring stack.
- SQLite persistence with an idempotent migration runner and optional
  automated backup worker.
- Cost guardrails — optional global and per-user monthly spend ceilings
  (`GLOBAL_MONTHLY_BUDGET_USD`, `USER_MONTHLY_BUDGET_USD`) limiting the
  estimated provider usage driven through the application.
- Rate limiting on registration, with trusted-proxy handling for
  `X-Forwarded-For`.
- Token-protected operator SMTP diagnostics endpoint.

#### Project and release infrastructure
- Apache-2.0 `LICENSE` and `NOTICE`, plus a runtime-specific
  `THIRD_PARTY_NOTICES.md` included in each published image.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), and
  `SECURITY.md` with a private disclosure process.
- GitHub issue templates (bug, feature), pull request template, `CODEOWNERS`,
  and Dependabot configuration.
- CI pipeline enforcing Ruff lint and format, Bandit, pip-audit, pytest with a
  90% coverage gate, CodeQL static analysis of the TypeScript sources,
  TypeScript type checking, ESLint, npm audit, Next.js production build, Vitest
  with enforced coverage floors, Playwright browser E2E tests, Docker image
  build and smoke tests, and Compose config validation.

### Known limitations

- Output quality and compatibility depend on the user-selected provider and model.
- SQLite only; no PostgreSQL support.
- No multi-tenant organization or team features.
- No published upgrade path between `0.x` releases — expect breaking changes.

[Unreleased]: https://github.com/chrysogonus/prompt-maker-studio/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.10.0
[0.9.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.9.0
[0.8.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.8.0
[0.7.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.7.0
[0.6.1]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.6.1
[0.6.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.6.0
[0.5.1]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.5.1
[0.5.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.5.0
[0.4.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.4.0
[0.3.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.3.0
[0.2.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.2.0
[0.1.4]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.1.4
[0.1.3]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.1.3
[0.1.2]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.1.2
[0.1.0]: https://github.com/chrysogonus/prompt-maker-studio/releases/tag/v0.1.0
