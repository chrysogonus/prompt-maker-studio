import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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

/** Links in the sidebar, so page content with the same name can't match. */
function sidebarLink(page: Page, name: string | RegExp) {
  return page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name });
}

async function register(page: Page, user: TestUser) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.locator('#reg-email').fill(user.email);
  await page.getByRole('button', { name: 'Create account' }).click();

  // The library is the home page; a new account starts with it empty.
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { name: 'Your prompt library is empty' })).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test(`refines unsaved sections with review, undo and normal saving (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
    await register(page, uniqueUser('refine'));
    // Only AI capability/results are mocked; auth, saving and version history are real.
    await page.route('**/api/prompts/config', (route) => route.fulfill({ json: {
      provider_connected: true, provider: 'ollama', provider_label: 'Ollama', model: 'local',
      available_models: [], budget_exhausted: false, global_budget_remaining_usd: null,
    } }));
    let calls = 0;
    await page.route('**/api/prompts/refine/questions', (route) => {
      calls += 1;
      expect(route.request().postDataJSON().fields).toEqual([{ name: 'Task', content: 'Explain {{topic}}.' }]);
      return route.fulfill({ json: { questions: ['Who will read this?', 'What should the answer look like?'] } });
    });
    await page.route('**/api/prompts/refine/draft', (route) => route.fulfill({ json: {
      fields: [{ name: 'Task', content: 'Explain {{topic}} to beginners in three short paragraphs.' }],
    } }));
    await sidebarLink(page, 'New prompt').click();
    await page.getByLabel('Task text').fill('Explain {{topic}}.');
    await page.getByRole('button', { name: 'Refine', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Refine prompt' });
    expect(calls).toBe(0);
    await expect(page.getByLabel('Task text')).toBeDisabled();
    await panel.getByRole('button', { name: 'Find questions' }).click();
    await panel.getByLabel('Who will read this?').fill('Beginners');
    await panel.getByLabel('What should the answer look like?').fill('Three short paragraphs');
    await expect(panel.getByLabel('Who will read this?')).toBeVisible();
    expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`refine-questions-${theme}.png`) });

    // The same session becomes a native full-screen modal at phone widths.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    await expect(panel.getByLabel('Who will read this?')).toHaveValue('Beginners');
    await page.keyboard.press('Tab');
    expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Refine', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Refine', exact: true }).click();
    expect(calls).toBe(1);
    await panel.getByRole('button', { name: 'Create draft' }).click();
    await expect(panel.getByRole('button', { name: 'Apply changes' })).toBeVisible();
    await expect(panel.getByLabel('Changes to Task').locator('ins').filter({ hasText: 'beginners' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const panelBox = await panel.boundingBox();
    expect(panelBox?.width).toBe(390);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter)).toBe('auto');
    await page.screenshot({ path: testInfo.outputPath(`refine-review-phone-${theme}.png`) });
    await panel.getByRole('button', { name: 'Apply changes' }).click();
    await expect(page.getByLabel('Task text')).toHaveValue('Explain {{topic}} to beginners in three short paragraphs.');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByLabel('Task text')).toHaveValue('Explain {{topic}}.');

    await page.getByRole('button', { name: 'Refine', exact: true }).click();
    await panel.getByRole('button', { name: 'Find questions' }).click();
    await panel.getByLabel('Who will read this?').fill('Beginners');
    await panel.getByRole('button', { name: 'Create draft' }).click();
    await panel.getByRole('button', { name: 'Apply changes' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const save = page.getByRole('dialog', { name: 'Save prompt' });
    await save.getByLabel('Name', { exact: true }).fill('Refined explanation');
    await save.getByRole('button', { name: 'Save prompt' }).click();
    await expect(page).toHaveURL(/\/editor\/\d+$/);
    await page.reload();
    await page.getByRole('tab', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('Task text')).toHaveValue('Explain {{topic}} to beginners in three short paragraphs.');
    await page.getByLabel('Task text').fill('Explain {{topic}} to beginners briefly.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('button', { name: /Version 1/ })).toBeVisible();
  });
}

test('keeps page headings in one place across navigation and adapts the shell to phones', async ({
  page,
}) => {
  const user = uniqueUser('layout');
  await page.setViewportSize({ width: 1440, height: 900 });
  await register(page, user);

  await sidebarLink(page, 'Settings').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  const settingsHeading = await page.getByRole('heading', { level: 1 }).boundingBox();

  await sidebarLink(page, 'New prompt').click();
  await expect(page.getByRole('heading', { level: 1, name: 'New prompt' })).toBeVisible();
  const editorHeading = await page.getByRole('heading', { level: 1 }).boundingBox();

  await sidebarLink(page, /All prompts/).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const libraryHeading = await page.getByRole('heading', { level: 1 }).boundingBox();

  for (const box of [settingsHeading, editorHeading, libraryHeading]) expect(box).not.toBeNull();
  expect(Math.abs(settingsHeading!.x - libraryHeading!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(editorHeading!.x - libraryHeading!.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(settingsHeading!.y - libraryHeading!.y)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter),
  ).toContain('stable');

  // On a phone the sidebar becomes a drawer behind the menu button.
  await page.setViewportSize({ width: 390, height: 844 });
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  await expect(sidebar).not.toBeInViewport();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(sidebar).toBeInViewport();
  await sidebarLink(page, 'Settings').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(sidebar).not.toBeInViewport();
  const newLink = await page.getByRole('banner').getByRole('link', { name: 'New' }).boundingBox();
  expect(newLink!.x + newLink!.width).toBeLessThanOrEqual(390);
});

/** Create and save a one-section prompt from /editor/new, returning its id. */
async function createSavedPrompt(page: Page, name: string, content: string) {
  await sidebarLink(page, 'New prompt').click();
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

  await sidebarLink(page, /All prompts/).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText(promptName)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await sidebarLink(page, /All prompts/).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText(promptName)).toBeVisible();
  await page.getByText(promptName).click();

  await expect(page).toHaveURL(/\/editor\/\d+$/);
  await expect(page.getByLabel('Task text')).toHaveValue('Verify saved prompt persistence');

  // Copies come from each prompt's menu; deleting one is undoable for a few
  // seconds and only then reaches the server, in both library layouts.
  await sidebarLink(page, /All prompts/).click();
  const duplicateName = `${promptName} Duplicate`;
  for (const layout of ['List', 'Grid']) {
    await page.getByRole('button', { name: layout, exact: true }).click();
    await page.getByRole('button', { name: `More actions for ${promptName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page.getByRole('link', { name: duplicateName, exact: true })).toBeVisible();

    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' && /\/api\/prompts\/\d+$/.test(response.url()),
    );
    await page.getByRole('button', { name: `More actions for ${duplicateName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByRole('link', { name: duplicateName, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    expect((await deleted).status()).toBe(204);
  }

  await page.getByRole('link', { name: promptName, exact: true }).click();
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

  await sidebarLink(page, 'New prompt').click();
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

test('explains Paste a prompt when no AI connection exists', async ({ page }) => {
  await register(page, uniqueUser('aiunavailable'));

  await sidebarLink(page, 'New prompt').click();
  await expect(page).toHaveURL(/\/editor\/new$/);
  await page.getByRole('button', { name: 'Paste a prompt' }).click();

  const dialog = page.getByRole('dialog', { name: 'Paste a prompt needs an AI connection' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
    'href',
    '/settings#s-api',
  );
});

test('files prompts into folders from the library and keeps Settings preferences', async ({
  page,
}) => {
  // Combined into one test because the e2e backend runs with its real
  // 5/minute register rate limit, so fresh accounts are scarce in one run.
  const user = uniqueUser('folders');
  await register(page, user);
  await createSavedPrompt(page, 'Status update ' + user.username, 'Summarise the week');

  // Filed from the library, the folder appears in the sidebar.
  await sidebarLink(page, /All prompts/).click();
  await page.getByRole('button', { name: /^More actions for Status update/ }).click();
  await page.getByRole('menuitem', { name: 'Move to folder…' }).click();
  const move = page.getByRole('dialog', { name: 'Move to folder' });
  await move.getByLabel('Folder').fill('Work');
  await move.getByRole('button', { name: 'Move' }).click();
  await sidebarLink(page, /^Work/).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Work' })).toBeVisible();

  // Renaming the folder moves its prompts; removing it unfiles them.
  await page.getByRole('button', { name: 'Actions for the Work folder' }).click();
  await page.getByRole('menuitem', { name: 'Rename folder' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename folder' });
  await rename.getByLabel('Name').fill('Job');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Job' })).toBeVisible();
  await expect(sidebarLink(page, /^Job/)).toBeVisible();

  await page.getByRole('button', { name: 'Actions for the Job folder' }).click();
  await page.getByRole('menuitem', { name: 'Remove folder…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove folder' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Unfiled' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Status update/ })).toBeVisible();
  await expect(sidebarLink(page, /^Job/)).toHaveCount(0);

  // Theme is stored in the browser; the library layout on the account.
  await sidebarLink(page, 'Settings').click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const savedView = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && /\/api\/auth\/me$/.test(response.url()),
  );
  await page.getByRole('radio', { name: 'Grid' }).click();
  expect((await savedView).status()).toBe(200);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  await sidebarLink(page, /All prompts/).click();
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
