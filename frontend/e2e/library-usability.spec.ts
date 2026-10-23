import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [1440, 390, 320]) {
  test(`library metadata, filing and import fit ${width}px`, async ({ page }, testInfo) => {
    const height = width < 500 ? 740 : 900;
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('prompt-maker-studio:client-session-expiry', String(Date.now() + 3_600_000)));
    let prompts = [{
      id: 1, name: 'Customer support response', fields: [{ name: 'Format', content: 'Use bullet points.' }, { name: 'Task', content: 'Background. '.repeat(90) + 'Answer {{question}} at the café clearly.' }],
      generated_prompt: '<TASK>Answer {{question}} clearly.</TASK>', folder: 'Customer support',
      created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', content_updated_at: '2026-10-01T12:00:00Z', is_favorite: false,
    }];
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path === '/api/auth/me') body = { id: 1, username: 'alex', email: 'alex@example.com', default_library_view: 'grid', created_at: '2026-10-01T00:00:00Z' };
      else if (path === '/api/prompts/saved') body = prompts;
      else if (path === '/api/prompts/1' && route.request().method() === 'PATCH') {
        prompts = [{ ...prompts[0], ...route.request().postDataJSON() }];
        body = prompts[0];
      } else if (path === '/api/prompts' && route.request().method() === 'POST') {
        const imported = { ...prompts[0], ...route.request().postDataJSON(), id: 2 };
        prompts.push(imported);
        body = imported;
      }
      await route.fulfill({ json: body });
    });
    await page.goto('/library');
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const card = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Customer support response', exact: true }) });
    const folder = card.getByText('Customer support', { exact: true });
    await expect(folder).toBeVisible();
    expect(await folder.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const metadata = await folder.locator('..').boundingBox();
    const actions = await card.getByRole('button', { name: 'Copy the Customer support response template' }).boundingBox();
    expect(metadata!.y + metadata!.height).toBeLessThanOrEqual(actions!.y);
    for (const button of [page.getByRole('button', { name: 'Grid', exact: true }), card.getByRole('button', { name: 'Add Customer support response to favourites' }), card.getByRole('button', { name: 'More actions for Customer support response' })]) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByLabel('Search prompts').fill('CAFÉ');
    await expect(card.getByText('Task:', { exact: true })).toBeVisible();
    await expect(card.locator('mark')).toHaveText('café');
    await expect(card.locator('mark')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`search-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(card.locator('mark')).toBeVisible();
    await page.getByLabel('Search prompts').clear();
    await expect(card.getByText(/^Background\./)).toBeVisible();
    await page.getByLabel('Select Customer support response').check();
    await page.getByLabel('File selected in folder').fill('Team');
    await page.getByRole('button', { name: 'Move selected' }).click();
    await expect(page.getByText('Moved 1 of 1 prompts.')).toBeVisible();
    await page.getByRole('button', { name: 'Add existing prompts', exact: true }).click();
    const note = '---\ntitle: New prompt\ntags: [work]\n---\nGive a useful answer.';
    await page.getByLabel('Or choose files').setInputFiles({ name: 'Daily note.md', mimeType: 'text/markdown', buffer: Buffer.from(note) });
    await expect(page.getByLabel('Title for a single note')).toHaveValue('Daily note');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByLabel('Title for prompt 1')).toHaveValue('New prompt');
    // Front matter is note metadata: removed by default, kept on request.
    await expect(page.locator('pre').filter({ hasText: 'Give a useful answer.' })).toHaveText('Give a useful answer.');
    await page.getByLabel(/Keep the original note text/).check();
    await expect(page.locator('pre').filter({ hasText: 'tags: [work]' })).toHaveText(note);
    await page.getByLabel(/Keep the original note text/).uncheck();
    await page.getByLabel('Folder for New prompt').fill('Team');
    const dialogBox = (await page.getByRole('dialog', { name: 'Add existing prompts' }).boundingBox())!;
    expect(dialogBox.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(height);
    // Nothing inside the dialog may be wider than the dialog, e.g. a row of buttons on phones.
    expect(await page.getByRole('dialog', { name: 'Add existing prompts' }).evaluate(d => d.scrollWidth <= d.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`import-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Keep as written' }).click();
    await expect(page.getByText(/Imported 1 prompt\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open imported prompt' })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('main').getByRole('link', { name: 'New prompt', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(audit.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`library-${width}.png`), fullPage: true });
  });
}

test('keeps the search in the address across folders, a prompt and Back', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('prompt-maker-studio:client-session-expiry', String(Date.now() + 3_600_000)));
  const prompt = (id: number, name: string, folder: string) => ({
    id, name, folder, fields: [{ name: 'Task', content: `Write the ${name.toLowerCase()}.` }], generated_prompt: '', is_favorite: false,
    created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', content_updated_at: '2026-10-01T12:00:00Z',
  });
  const prompts = [prompt(1, 'Café menu', 'Food'), prompt(2, 'Status update', 'Work')];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/auth/me' ? { id: 1, username: 'alex', email: 'alex@example.com', default_library_view: 'list', created_at: '2026-10-01T00:00:00Z' }
      : path === '/api/prompts/saved' ? prompts
      : path === '/api/prompts/1' ? prompts[0]
      : /\/(versions|runs|cases)$/.test(path) ? [] : {};
    await route.fulfill({ json: body });
  });
  await page.goto('/library');
  const search = page.getByLabel('Search prompts');
  await search.fill('cafe');
  await expect(page).toHaveURL(/\/library\?q=cafe$/);
  await expect(page.getByRole('link', { name: 'Status update', exact: true })).toHaveCount(0);

  // A folder link has no query; Back returns to the search.
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name: /^Work/ }).click();
  await expect(page).toHaveURL(/folder=Work/);
  await expect(search).toHaveValue('');
  await page.goBack();
  await expect(page).toHaveURL(/\/library\?q=cafe$/);
  await expect(search).toHaveValue('cafe');

  await page.getByRole('link', { name: 'Café menu', exact: true }).click();
  await expect(page).toHaveURL(/\/editor\/1/);
  await page.goBack();
  await expect(search).toHaveValue('cafe');
  await expect(page.getByRole('link', { name: 'Status update', exact: true })).toHaveCount(0);

  // The current view's own link drops the query, as its address says.
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name: /^All prompts/ }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(search).toHaveValue('');
  await expect(page.getByRole('link', { name: 'Status update', exact: true })).toBeVisible();
});
