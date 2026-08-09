import { expect, test, type Page } from '@playwright/test';

interface TestUser {
  username: string;
  password: string;
  email: string;
}

function uniqueUser(prefix: string): TestUser {
  const suffix = String(Date.now()) + String(Math.floor(Math.random() * 10_000));
  return {
    username: prefix + suffix,
    password: 'E2ePass123!',
    // NOTE: the backend's email validator (email-validator via Pydantic) rejects the
    // RFC 2606 reserved TLDs (.test, .example, .invalid, .localhost) as "special-use",
    // so a fake address must use a normal-looking TLD like .com instead.
    email: prefix + suffix + '@example.com',
  };
}

/** The breadcrumb on Editor/Detail also links to "Library", so nav clicks must be scoped. */
function navLink(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('link', { name });
}

async function register(page: Page, user: TestUser) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.locator('#reg-email').fill(user.email);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Dashboard is the post-login landing page in the new IA.
  await expect(page.getByText(`Good to see you, ${user.username}`)).toBeVisible();
}

test('keeps top-level headers and centered chrome stable across navigation', async ({ page }) => {
  const user = uniqueUser('layout');
  await page.setViewportSize({ width: 1440, height: 900 });
  await register(page, user);

  const dashboardHeading = await page.getByRole('heading', { level: 1 }).boundingBox();
  const dashboardAction = await page
    .getByRole('link', { name: '+ New prompt', exact: true })
    .boundingBox();
  const dashboardMain = await page.locator('main').boundingBox();

  await navLink(page, 'Library').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Prompt library' })).toBeVisible();

  const libraryHeading = await page.getByRole('heading', { level: 1 }).boundingBox();
  const libraryAction = await page
    .getByRole('link', { name: '+ New prompt', exact: true })
    .boundingBox();
  const libraryMain = await page.locator('main').boundingBox();

  expect(dashboardHeading).not.toBeNull();
  expect(dashboardAction).not.toBeNull();
  expect(dashboardMain).not.toBeNull();
  expect(libraryHeading).not.toBeNull();
  expect(libraryAction).not.toBeNull();
  expect(libraryMain).not.toBeNull();
  expect(Math.abs(libraryHeading!.y - dashboardHeading!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(libraryAction!.y - dashboardAction!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(libraryAction!.height - dashboardAction!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(libraryMain!.x - dashboardMain!.x)).toBeLessThanOrEqual(1);

  await navLink(page, 'Editor').click();
  await expect(page.getByRole('heading', { level: 1, name: 'New prompt' })).toBeVisible();
  const editorHeading = await page.getByRole('heading', { level: 1 }).boundingBox();
  const editorMain = await page.locator('main').boundingBox();

  await navLink(page, 'Library').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Prompt library' })).toBeVisible();
  const libraryAfterEditorHeading = await page.getByRole('heading', { level: 1 }).boundingBox();
  const libraryAfterEditorMain = await page.locator('main').boundingBox();

  expect(editorHeading).not.toBeNull();
  expect(editorMain).not.toBeNull();
  expect(libraryAfterEditorHeading).not.toBeNull();
  expect(libraryAfterEditorMain).not.toBeNull();
  expect(Math.abs(libraryAfterEditorHeading!.y - editorHeading!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(libraryAfterEditorMain!.x - editorMain!.x)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter)
  ).toContain('stable');

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowHeading = await page.getByRole('heading', { level: 1 }).boundingBox();
  const narrowAction = await page
    .getByRole('link', { name: '+ New prompt', exact: true })
    .boundingBox();
  expect(narrowHeading).not.toBeNull();
  expect(narrowAction).not.toBeNull();
  expect(narrowAction!.y).toBeGreaterThanOrEqual(narrowHeading!.y + narrowHeading!.height);
  expect(narrowAction!.x + narrowAction!.width).toBeLessThanOrEqual(390);
});

test('registers, generates, saves, and reloads a prompt after signing in again', async ({ page }) => {
  const user = uniqueUser('workflow');
  const promptName = 'E2E Prompt ' + user.username;

  await register(page, user);

  await page.getByRole('link', { name: '+ New prompt' }).click();
  await expect(page).toHaveURL(/\/editor\/new$/);

  await page.getByPlaceholder(/field name/i).fill('goal');
  await page.getByPlaceholder(/enter content for this field/i).fill('Verify saved prompt persistence');
  await page.getByRole('button', { name: 'Generate Prompt' }).click();

  const output = page.locator('pre[aria-label]');
  await expect(output).toContainText('<GOAL>');
  await expect(output).toContainText('Verify saved prompt persistence');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Prompt Name').fill(promptName);
  await page.getByLabel('Prompt Name').press('Enter');

  // Saving an unnamed prompt redirects from /editor/new to its stable /editor/{id} URL.
  await expect(page).toHaveURL(/\/editor\/\d+$/);

  await navLink(page, 'Library').click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText(promptName)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await navLink(page, 'Library').click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText(promptName)).toBeVisible();
  await page.getByText(promptName).click();

  // /editor/{id} is the Editor/Detail screen (breadcrumb + template textarea + version history).
  await expect(page).toHaveURL(/\/editor\/\d+$/);
  await expect(page.getByLabel('Prompt template')).toHaveValue(
    /Verify saved prompt persistence/,
  );

  // The source stays intact while independently-created copies can be deleted
  // through both Library layouts. Waiting for DELETE also covers the five-second
  // undo window rather than only asserting the optimistic UI removal.
  await navLink(page, 'Library').click();
  const sourceGroup = page.getByRole('group').filter({ hasText: promptName });
  await sourceGroup.getByRole('button', { name: /^Duplicate / }).click();
  const duplicateName = `${promptName} Duplicate`;
  let duplicateGroup = page.getByRole('group').filter({ hasText: duplicateName });
  await expect(duplicateGroup).toBeVisible();

  await duplicateGroup.getByRole('button', { name: /^Delete / }).click();
  const gridDelete = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' && /\/api\/prompts\/\d+$/.test(response.url()),
  );
  await duplicateGroup.getByRole('button', { name: /^Confirm delete / }).click();
  await expect(duplicateGroup).not.toBeVisible();
  await gridDelete;

  await sourceGroup.getByRole('button', { name: /^Duplicate / }).click();
  await page.getByRole('radio', { name: 'List' }).click();
  duplicateGroup = page.getByRole('group').filter({ hasText: duplicateName });
  await expect(duplicateGroup).toBeVisible();
  await duplicateGroup.getByRole('button', { name: /^Delete / }).click();
  const listDelete = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' && /\/api\/prompts\/\d+$/.test(response.url()),
  );
  await duplicateGroup.getByRole('button', { name: /^Confirm delete / }).click();
  await expect(duplicateGroup).not.toBeVisible();
  await listDelete;

  await expect(page.getByText(promptName, { exact: true })).toBeVisible();
  await page.getByText(promptName, { exact: true }).click();
  await expect(page.getByLabel('Prompt template')).toHaveValue(
    /Verify saved prompt persistence/,
  );
});

test('edits a saved prompt twice and restores an earlier version', async ({ page }) => {
  const user = uniqueUser('versioning');
  const promptName = 'Versioned Prompt ' + user.username;

  await register(page, user);

  await page.getByRole('link', { name: '+ New prompt' }).click();
  await page.getByPlaceholder(/field name/i).fill('goal');
  await page.getByPlaceholder(/enter content for this field/i).fill('version one content');
  await page.getByRole('button', { name: 'Generate Prompt' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Prompt Name').fill(promptName);
  await page.getByLabel('Prompt Name').press('Enter');
  await expect(page).toHaveURL(/\/editor\/\d+$/);

  const template = page.getByLabel('Prompt template');
  await expect(template).toHaveValue(/version one content/);

  // First edit snapshots the pre-edit state ("version one content") as v1.
  await template.fill('<GOAL>\nversion two content\n</GOAL>');
  const firstUpdate = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /\/api\/prompts\/\d+$/.test(response.url()),
  );
  await page.getByRole('button', { name: 'Update' }).click();
  await firstUpdate;
  await expect(page.getByRole('button', { name: 'Update' })).toBeEnabled();
  await expect(page.getByText('v1', { exact: true })).toBeVisible();

  // Second edit snapshots "version two content" as v2.
  await template.fill('<GOAL>\nversion three content\n</GOAL>');
  const secondUpdate = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /\/api\/prompts\/\d+$/.test(response.url()),
  );
  await page.getByRole('button', { name: 'Update' }).click();
  await secondUpdate;
  await expect(page.getByRole('button', { name: 'Update' })).toBeEnabled();
  await expect(template).toHaveValue(/version three content/);
  await expect(page.getByText('v2', { exact: true })).toBeVisible();

  await page.getByText('v2', { exact: true }).click();
  await expect(page.getByLabel('Version comparison')).toContainText('version two');

  await page
    .locator('[data-selected="true"]')
    .getByRole('button', { name: 'Restore this version' })
    .click();
  await expect(template).toHaveValue(/version two content/);
});

/** Create and save a prompt from /editor/new, returning its detail URL id. */
async function createSavedPrompt(page: Page, name: string, content: string) {
  await page.getByRole('link', { name: '+ New prompt' }).click();
  await page.getByPlaceholder(/field name/i).fill('goal');
  await page.getByPlaceholder(/enter content for this field/i).fill(content);
  await page.getByRole('button', { name: 'Generate Prompt' }).click();
  await expect(page.locator('pre[aria-label]')).toContainText('<GOAL>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Prompt Name').fill(name);
  await page.getByLabel('Prompt Name').press('Enter');
  await expect(page).toHaveURL(/\/editor\/\d+$/);
  return page.url().match(/\/editor\/(\d+)$/)![1];
}

test('blocks case-variant duplicate field names and saves the current field state', async ({
  page,
}) => {
  const user = uniqueUser('newprompt');
  const promptName = 'Field State ' + user.username;

  await register(page, user);

  await page.getByRole('link', { name: '+ New prompt' }).click();
  await expect(page).toHaveURL(/\/editor\/new$/);

  // D3: both names upper-case to the same <QA_DUP> tag, so this must be
  // blocked before submit exactly like an exact-case duplicate.
  await page.getByPlaceholder(/field name/i).fill('QA_dup');
  await page.getByPlaceholder(/enter content for this field/i).fill('first');
  await page.getByRole('button', { name: '+ Add Field' }).click();
  await page.getByPlaceholder(/field name/i).nth(1).fill('qa_DUP');
  await page.getByPlaceholder(/enter content for this field/i).nth(1).fill('second');

  await expect(page.getByText('Field names must be unique.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate Prompt' })).toBeDisabled();

  // D2: generate, then rename a field without regenerating. Save must persist
  // the renamed state, not the preview captured before the rename.
  await page.getByPlaceholder(/field name/i).nth(1).fill('qa_second');
  await expect(page.getByRole('button', { name: 'Generate Prompt' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate Prompt' }).click();
  await expect(page.locator('pre[aria-label]')).toContainText('QA_SECOND');

  await page.getByPlaceholder(/field name/i).nth(1).fill('QA_renamed_no_regen');
  await expect(page.getByText(/Fields changed since this was generated/)).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Prompt Name').fill(promptName);
  await page.getByLabel('Prompt Name').press('Enter');
  await expect(page).toHaveURL(/\/editor\/\d+$/);

  const template = page.getByLabel('Prompt template');
  await expect(template).toHaveValue(/<QA_RENAMED_NO_REGEN>/);
  await expect(template).not.toHaveValue(/<QA_SECOND>/);

  // And it is what actually reached the database, not just what is on screen.
  await page.reload();
  await expect(page.getByLabel('Prompt template')).toHaveValue(/<QA_RENAMED_NO_REGEN>/);
});

test('handles rapid variable edits, a real two-tab conflict, exports, and Playground booleans', async ({
  page,
  context,
}) => {
  const user = uniqueUser('concurrency');
  const promptName = 'Concurrent Prompt ' + user.username;

  await register(page, user);
  const promptId = await createSavedPrompt(
    page,
    promptName,
    'Handle {{alpha}} for {{beta}} and mention {{alpha}} again.',
  );

  // ---- D1: two variable-type changes fired back to back must both persist.
  const patchStatuses: number[] = [];
  page.on('response', (response) => {
    if (
      response.request().method() === 'PATCH' &&
      new RegExp(`/api/prompts/${promptId}$`).test(response.url())
    ) {
      patchStatuses.push(response.status());
    }
  });

  await page.getByLabel('alpha type').selectOption('number');
  await page.getByLabel('beta type').selectOption('boolean');

  await expect.poll(() => patchStatuses.length, { timeout: 10_000 }).toBe(2);
  expect(patchStatuses).toEqual([200, 200]);
  await expect(page.getByText(/modified by another session/)).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel('alpha type')).toHaveValue('number');
  await expect(page.getByLabel('beta type')).toHaveValue('boolean');

  // ---- D1b: a genuine cross-session conflict must still 409.
  const tabB = await context.newPage();
  await tabB.goto(`/editor/${promptId}`);
  await expect(tabB.getByLabel('Prompt template')).toHaveValue(/alpha/);

  await page.getByLabel('Prompt template').fill('<GOAL>\ntab A wins {{alpha}}\n</GOAL>');
  const tabAUpdate = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new RegExp(`/api/prompts/${promptId}$`).test(response.url()),
  );
  await page.getByRole('button', { name: 'Update' }).click();
  expect((await tabAUpdate).status()).toBe(200);

  const tabBDraft = '<GOAL>\ntab B draft {{alpha}}\n</GOAL>';
  await tabB.getByLabel('Prompt template').fill(tabBDraft);
  const tabBUpdate = tabB.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new RegExp(`/api/prompts/${promptId}$`).test(response.url()),
  );
  await tabB.getByRole('button', { name: 'Update' }).click();
  expect((await tabBUpdate).status()).toBe(409);

  await expect(tabB.getByText(/modified by another session/)).toBeVisible();
  // The rejected draft is preserved, and the banner offers the action it names.
  await expect(tabB.getByLabel('Prompt template')).toHaveValue(tabBDraft);
  await tabB.getByRole('button', { name: 'Reload' }).click();
  await expect(tabB.getByText(/modified by another session/)).toHaveCount(0);
  await expect(tabB.getByLabel('Prompt template')).toHaveValue(tabBDraft);
  await expect(tabB.getByText(/Unsaved draft/)).toBeVisible();
  await tabB.close();

  // ---- D5: a variable used twice must be substituted everywhere by the
  // exported TypeScript snippet.
  await page.reload();
  await page
    .getByLabel('Prompt template')
    .fill('<GOAL>\nSell {{product}}.\n</GOAL>\n\n<QA_NOTE>\nSecond mention of {{product}}.\n</QA_NOTE>');
  const exportUpdate = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new RegExp(`/api/prompts/${promptId}$`).test(response.url()),
  );
  await page.getByRole('button', { name: 'Update' }).click();
  await exportUpdate;

  await page.getByRole('radiogroup', { name: 'Snippet language' }).getByRole('radio', { name: 'TypeScript' }).click();
  const snippet = page.getByRole('region', { name: /typescript integration snippet/i });
  await expect(snippet).toContainText('prompt.replaceAll("{{product}}", String(product));');
  await expect(snippet).not.toContainText('prompt.replace("{{product}}"');

  // ---- D4: an untouched Boolean is a valid `false`; preflight is advisory and
  // never disables Run. The config response is stubbed because the e2e stack
  // deliberately runs without an OpenAI key — no model call is ever made here.
  await page
    .getByLabel('Prompt template')
    .fill('<GOAL>\nTriage {{ticket}} urgently? {{is_urgent}}\n</GOAL>');
  const boolUpdate = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new RegExp(`/api/prompts/${promptId}$`).test(response.url()),
  );
  await page.getByRole('button', { name: 'Update' }).click();
  await boolUpdate;
  const booleanTypeSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new RegExp(`/api/prompts/${promptId}$`).test(response.url()),
  );
  await page.getByLabel('is_urgent type').selectOption('boolean');
  expect((await booleanTypeSaved).status()).toBe(200);

  await page.route('**/api/prompts/config', (route) =>
    route.fulfill({
      json: {
        provider_connected: true,
        provider: 'openai',
        provider_label: 'OpenAI',
        model: 'gpt-4.1-mini',
        available_models: ['gpt-4.1-mini'],
        budget_exhausted: false,
        global_budget_remaining_usd: null,
      },
    }),
  );
  await page.goto(`/playground/${promptId}`);

  await expect(page.getByRole('switch', { name: 'is_urgent' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // `ticket` is still empty, so preflight warns — advisory only.
  await expect(page.getByLabel('Preflight checks')).toContainText('Missing a value for ticket');
  await expect(page.getByLabel('Preflight checks')).not.toContainText('is_urgent');
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
});

test('labels the auto-created pre-refinement snapshot "Before AI refinement"', async ({ page }) => {
  const user = uniqueUser('refine');
  const promptName = 'Refined Prompt ' + user.username;

  // The Refine tab's two OpenAI-backed calls are stubbed so this runs
  // deterministically and offline; the version-history behaviour under test is
  // entirely server-side and unaffected by where the draft text came from.
  const original = 'pre-refinement content';
  const refined = '<GOAL>\npost-refinement content\n</GOAL>';
  await page.route('**/refine/questions**', (route) =>
    route.fulfill({ json: { questions: ['Who is the audience?'] } }),
  );
  await page.route('**/refine/draft', (route) => route.fulfill({ json: { draft: refined } }));

  await register(page, user);
  await createSavedPrompt(page, promptName, original);

  await page.getByRole('button', { name: 'Refine' }).click();
  await page.getByRole('button', { name: 'Ask for clarification' }).click();
  await page.locator('#answer-input-0').fill('Support agents triaging tickets.');
  await page.getByRole('button', { name: 'Generate suggestion' }).click();
  await expect(page.getByLabel('Proposed changes diff')).toContainText('post-refinement');

  await page.getByRole('button', { name: 'Accept & update prompt' }).click();
  await expect(page.getByText('Refinement accepted and saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Configuration' }).click();
  await expect(page.getByLabel('Prompt template')).toHaveValue(/post-refinement content/);

  // The snapshot created by the refinement is labelled for what it holds, so a
  // user rolling a refinement back can find it among ordinary "Edit" entries.
  const snapshot = page.getByText('Before AI refinement');
  await expect(snapshot).toBeVisible();

  // The word-level diff interleaves removed and added tokens, so assert on the
  // distinctive words rather than a contiguous string...
  await snapshot.click();
  const comparison = page.getByLabel('Version comparison');
  await expect(comparison).toContainText('pre-refinement');
  await expect(comparison).toContainText('post-refinement');

  // ...and prove what that snapshot actually holds by restoring it.
  await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.getByLabel('Prompt template')).toHaveValue(/pre-refinement content/);
  await expect(page.getByLabel('Prompt template')).not.toHaveValue(/post-refinement/);
});

test('shows the unavailable AI-import state when no provider is connected', async ({ page }) => {
  await register(page, uniqueUser('aiunavailable'));

  await page.getByRole('link', { name: '+ New prompt' }).click();
  await expect(page).toHaveURL(/\/editor\/new$/);

  // The importer is the hero of this screen and is expanded on arrival.
  await expect(page.getByRole('heading', { name: /import from text/i })).toBeVisible();

  await expect(
    page.getByText(/AI import needs an AI provider/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Parse & Import Fields' })).toBeDisabled();
});

test('shows the unavailable Playground state when no provider is connected', async ({ page }) => {
  // A freshly registered user has no LLM provider connection, so this
  // deterministic disabled-state assertion never makes a real, billed API
  // call — a live run is deliberately not part of the required e2e suite.
  const user = uniqueUser('noplayground');
  await register(page, user);

  await page.getByRole('link', { name: '+ New prompt' }).click();
  await page.getByPlaceholder(/field name/i).fill('goal');
  await page.getByPlaceholder(/enter content for this field/i).fill('playground test content');
  await page.getByRole('button', { name: 'Generate Prompt' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Prompt Name').fill('Playground Test ' + user.username);
  await page.getByLabel('Prompt Name').press('Enter');
  await expect(page).toHaveURL(/\/editor\/\d+$/);

  await page.getByRole('link', { name: /test in playground/i }).click();
  await expect(page).toHaveURL(/\/playground\/\d+$/);

  await expect(page.getByText(/Playground needs an AI provider/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
});

test('Dashboard renders real, honest zero stats, and Settings preferences persist across a reload', async ({
  page,
}) => {
  // Combined into one test (rather than a separate registration) because the
  // e2e backend runs with its real 5/minute register rate limit — unlike
  // pytest's TESTING env, nothing here bypasses it, so each e2e test that
  // needs a fresh account is a scarce resource within a single suite run.
  const user = uniqueUser('dashboard');
  await register(page, user);

  // Post-registration, the Dashboard must show real zero/placeholder values,
  // never fabricated numbers — no prompts or Playground runs exist yet.
  await expect(page.getByText('Runs this month')).toBeVisible();
  await expect(page.getByText('Star prompts in the Library to pin them here.')).toBeVisible();
  await expect(
    page.getByText('Run prompts in the Playground to see your top prompts here.'),
  ).toBeVisible();

  await navLink(page, 'Settings').click();
  await expect(page).toHaveURL(/\/settings$/);

  // Theme and density are pure frontend preferences applied as data-attributes.
  await page.getByRole('radio', { name: 'Light' }).click();
  await page.getByRole('radio', { name: 'Compact' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

  // Run-failure notification preference is persisted server-side.
  const runFailureToggle = page.getByRole('switch', { name: 'Run failures' });
  await expect(runFailureToggle).toHaveAttribute('aria-checked', 'false');
  await runFailureToggle.click();
  await expect(runFailureToggle).toHaveAttribute('aria-checked', 'true');

  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.getByRole('switch', { name: 'Run failures' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
