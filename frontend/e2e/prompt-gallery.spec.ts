import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const paths = ['/gallery', '/gallery/bug-fix-brief', '/gallery/product-photo', '/gallery/summarize-with-sources'];

test('gallery pages serve their templates and metadata without JavaScript', async ({ request }) => {
  for (const path of paths) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h1>');
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="https?://[^"\\s]+${path}"`));
  }
  expect(await (await request.get('/gallery/bug-fix-brief')).text()).toContain('regression test');
  expect((await request.get('/gallery/no-such-template')).status()).toBe(404);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of paths) expect(sitemap).toContain(`${path}</loc>`);
});

test('a template fills in with example inputs, saves into a new library and reopens intact', async ({ page }) => {
  const suffix = String(Date.now()) + String(Math.floor(Math.random() * 10_000));
  await page.goto('/gallery');
  await page.getByRole('region', { name: 'Featured' }).getByRole('link', { name: 'Bug fix brief for a coding agent' }).click();
  await expect(page).toHaveURL(/\/gallery\/bug-fix-brief$/);
  await page.getByRole('button', { name: 'Use example inputs' }).click();
  await expect(page.getByLabel('Filled prompt')).toContainText('npm test passes');
  await page.getByRole('button', { name: 'Save to my library' }).click();

  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('save “Bug fix brief for a coding agent” to your library');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#username').fill(`gallery${suffix}`);
  await page.locator('#password').fill('E2ePass123!');
  await page.locator('#reg-email').fill(`gallery${suffix}@example.com`);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText(/^Imported \d+ sections into draft—save to keep\.$/)).toBeVisible();
  await expect(page.getByLabel('check_command', { exact: true })).toHaveValue('npm test');
  await expect(page.getByLabel('Goal text')).toHaveValue(/\{\{symptom\}\}/);

  // Save, then reload: the sections and the template's hints are in the library.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const save = page.getByRole('dialog', { name: 'Save prompt' });
  await expect(save.getByLabel('Name', { exact: true })).toHaveValue('Bug fix brief for a coding agent');
  await save.getByRole('button', { name: 'Save prompt' }).click();
  await expect(page).toHaveURL(/\/editor\/\d+$/);
  await page.reload();
  await page.getByRole('button', { name: 'Edit template', exact: true }).click();
  await expect(page.getByLabel('Goal text')).toHaveValue('Fix this bug: {{symptom}}. Expected behaviour: {{expected}}.');
  await expect(page.getByLabel('Done when text')).toHaveValue(/regression test/);
  await expect(page.getByLabel('Hint for symptom')).toHaveValue('What goes wrong, and how to reproduce it');
});

for (const path of paths) {
  test(`${path} fits phones and desktops with accessible content in both themes`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const theme of ['light', 'dark']) {
        await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      }
    }
  });
}
