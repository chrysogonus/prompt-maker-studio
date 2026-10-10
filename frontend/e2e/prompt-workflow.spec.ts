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

/** Nav clicks are scoped to the navigation landmark so page content can't match. */
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

/** Create and save a one-section prompt from /editor/new, returning its id. */
async function createSavedPrompt(page: Page, name: string, content: string) {
  await page.getByRole('link', { name: '+ New prompt' }).click();
  await expect(page).toHaveURL(/\/editor\/new$/);
  await page.getByLabel('Task text').fill(content);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save prompt' });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Name', { exact: true }).press('Enter');
  // Saving moves from /editor/new to the prompt's stable /editor/{id} URL.
  await expect(page).toHaveURL(/\/editor\/\d+$/);
  return page.url().match(/\/editor\/(\d+)$/)![1];
}

function promptPatch(page: Page, promptId: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new RegExp(`/api/prompts/${promptId}$`).test(response.url()),
  );
}

test('registers, saves, and reloads a prompt after signing in again', async ({ page }) => {
  const user = uniqueUser('workflow');
  const promptName = 'E2E Prompt ' + user.username;

  await register(page, user);
  await createSavedPrompt(page, promptName, 'Verify saved prompt persistence');

  // The preview shows the text exactly as it will be copied.
  const preview = page.getByLabel('Prompt text');
  await expect(preview).toContainText('<TASK>');
  await expect(preview).toContainText('Verify saved prompt persistence');

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

  await expect(page).toHaveURL(/\/editor\/\d+$/);
  await expect(page.getByLabel('Task text')).toHaveValue('Verify saved prompt persistence');

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
  await expect(page.getByLabel('Task text')).toHaveValue('Verify saved prompt persistence');
});

test('edits a saved prompt twice and restores an earlier version', async ({ page }) => {
  const user = uniqueUser('versioning');
  await register(page, user);
  const promptId = await createSavedPrompt(
    page,
    'Versioned Prompt ' + user.username,
    'version one content',
  );

  const task = page.getByLabel('Task text');

  // Ctrl+S saves here instead of opening the browser's "Save page" dialog.
  await task.fill('version two content');
  const firstSave = promptPatch(page, promptId);
  await page.keyboard.press('Control+s');
  expect((await firstSave).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  await task.fill('version three content');
  await page.getByLabel('Version note').fill('Third pass');
  const secondSave = promptPatch(page, promptId);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await secondSave).status()).toBe(200);

  await page.getByRole('button', { name: 'History' }).click();
  const history = page.getByRole('complementary', { name: 'Version history' });
  await expect(history.getByText('Version 3, current')).toBeVisible();
  await expect(history.getByText('Third pass')).toBeVisible();

  await history.getByRole('button', { name: /^Version 2/ }).click();
  await expect(history.getByLabel('Changes since this version')).toContainText('two');
  await history.getByRole('button', { name: 'Restore version 2' }).click();
  await expect(task).toHaveValue('version two content');

  // And it is what the server now holds, not just what is on screen.
  await page.reload();
  await expect(page.getByLabel('Task text')).toHaveValue('version two content');
});

test('blocks section names that render to the same tag and saves spaced names', async ({
  page,
}) => {
  const user = uniqueUser('newprompt');
  await register(page, user);

  await page.getByRole('link', { name: '+ New prompt' }).click();
  await expect(page).toHaveURL(/\/editor\/new$/);
  await page.getByLabel('Task text').fill('Summarise {{source}}');

  // "task" and "Task" both become <TASK>, so saving must be blocked.
  await page.getByRole('button', { name: 'Add section' }).click();
  const names = page.getByLabel('Section name');
  await names.nth(1).fill('task');
  await expect(page.getByText(/Another section already becomes <TASK>/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Fix the highlighted section names before saving.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Save prompt' })).toHaveCount(0);

  // A display name with a space is fine; only its tag uses an underscore.
  await names.nth(1).fill('Output format');
  await page.getByLabel('Output format text').fill('Five bullets');
  await expect(page.getByLabel('Prompt text')).toContainText('<OUTPUT_FORMAT>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save prompt' });
  await dialog.getByLabel('Name', { exact: true }).fill('Field State ' + user.username);
  await dialog.getByLabel('Name', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/editor\/\d+$/);

  await page.reload();
  await expect(page.getByLabel('Section name').nth(1)).toHaveValue('Output format');
  await expect(page.getByLabel('Output format text')).toHaveValue('Five bullets');
});

test('fills variables, keeps hints, and survives a real two-tab conflict', async ({
  page,
  context,
}) => {
  const user = uniqueUser('concurrency');
  await register(page, user);
  const promptId = await createSavedPrompt(
    page,
    'Concurrent Prompt ' + user.username,
    'Handle {{alpha}} for {{beta}} and mention {{alpha}} again.',
  );

  // A hint is saved with the prompt and shown while filling it in.
  await page.getByLabel('Hint for alpha').fill('The thing to handle');
  const hintSave = promptPatch(page, promptId);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await hintSave).status()).toBe(200);
  await page.reload();
  await page.getByRole('radio', { name: 'Filled' }).click();
  await page.getByPlaceholder('The thing to handle').fill('refunds');
  const preview = page.getByLabel('Prompt text');
  await expect(preview).toContainText('Handle refunds for {{beta}} and mention refunds again.');
  await expect(page.getByText('beta is not filled in.')).toBeVisible();

  // A genuine cross-session conflict still returns 409, and keeps the edit.
  const tabB = await context.newPage();
  await tabB.goto(`/editor/${promptId}`);
  await expect(tabB.getByLabel('Task text')).toHaveValue(/alpha/);

  await page.getByLabel('Task text').fill('tab A wins {{alpha}}');
  const tabASave = promptPatch(page, promptId);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await tabASave).status()).toBe(200);

  await tabB.getByLabel('Task text').fill('tab B draft {{alpha}}');
  const tabBSave = promptPatch(tabB, promptId);
  await tabB.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await tabBSave).status()).toBe(409);

  await expect(tabB.getByText(/changed somewhere else/)).toBeVisible();
  await tabB.getByRole('button', { name: 'Load latest version' }).click();
  await expect(tabB.getByText(/changed somewhere else/)).toHaveCount(0);
  await expect(tabB.getByLabel('Task text')).toHaveValue('tab B draft {{alpha}}');

  // Saving after loading the latest version overwrites it on purpose.
  const overwrite = promptPatch(tabB, promptId);
  await tabB.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await overwrite).status()).toBe(200);
  await tabB.close();
});

test('explains Import text when no AI connection exists', async ({ page }) => {
  await register(page, uniqueUser('aiunavailable'));

  await page.getByRole('link', { name: '+ New prompt' }).click();
  await expect(page).toHaveURL(/\/editor\/new$/);
  await page.getByRole('button', { name: 'Import text' }).click();

  const dialog = page.getByRole('dialog', { name: 'Import text needs an AI connection' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
    'href',
    '/settings#s-api',
  );
});

test('shows the unavailable Playground state when no provider is connected', async ({ page }) => {
  // A freshly registered user has no LLM provider connection, so this
  // deterministic disabled-state assertion never makes a real, billed API
  // call — a live run is deliberately not part of the required e2e suite.
  const user = uniqueUser('noplayground');
  await register(page, user);
  const promptId = await createSavedPrompt(
    page,
    'Playground Test ' + user.username,
    'playground test content',
  );

  await page.goto(`/playground/${promptId}`);

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
