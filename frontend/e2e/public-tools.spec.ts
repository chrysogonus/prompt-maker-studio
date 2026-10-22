import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const paths = [
  '/tools',
  '/tools/prompt-template-filler',
  '/tools/prompt-linter',
  '/tools/prompt-diff',
  '/tools/token-counter',
];

test('tool pages serve their text, FAQ and metadata without JavaScript', async ({ request }) => {
  for (const path of paths) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h1>');
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="https?://[^"\\s]+${path}"`));
    expect(html).toContain('name="description"');
    if (path !== '/tools') {
      expect(html).toContain('Runs in your browser. Nothing you enter is uploaded.');
      expect(html).toContain('"@type":"FAQPage"');
    }
  }
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of paths) expect(sitemap).toContain(`${path}</loc>`);
});

test('browser-only tools send nothing they are given', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') sent.push(`${request.method()} ${request.url()}`);
  });
  await page.goto('/tools/prompt-template-filler');
  await page.getByRole('textbox', { name: 'customer_name' }).fill('Dana');
  await expect(page.getByLabel('Filled prompt')).toContainText('reply to Dana about');
  await page.goto('/tools/prompt-linter');
  await page.getByRole('textbox', { name: 'Your prompt' }).fill('Explain {{topic}}');
  await expect(page.getByRole('status')).toContainText('suggestions');
  await page.goto('/tools/prompt-diff');
  await expect(page.getByLabel('Changes from before to after')).toBeVisible();
  await page.goto('/tools/token-counter');
  await page.getByRole('textbox', { name: 'Your prompt' }).fill('x'.repeat(400));
  await expect(page.getByText('≈ 100')).toBeVisible();
  await expect(page.getByRole('row', { name: /OpenAI/ }).first()).toBeVisible();
  expect(sent).toEqual([]);
});

test('a filled template saves into a new library after signing up', async ({ page }) => {
  const suffix = String(Date.now()) + String(Math.floor(Math.random() * 10_000));
  await page.goto('/tools/prompt-template-filler');
  await page.getByRole('textbox', { name: 'customer_name' }).fill('Dana');
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/\/editor\/new\?import=1$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#username').fill(`tools${suffix}`);
  await page.locator('#password').fill('E2ePass123!');
  await page.locator('#reg-email').fill(`tools${suffix}@example.com`);
  await page.getByRole('button', { name: 'Create account' }).click();

  const review = page.getByRole('dialog', { name: 'Review your template' });
  await expect(review).toBeVisible();
  await expect(review.getByRole('textbox', { name: 'Value for customer_name' })).toHaveValue('Dana');
  await review.getByRole('button', { name: 'Use in editor' }).click();
  await expect(page.getByLabel('Task text')).toHaveValue(/\{\{customer_name\}\}/);
});

test('tool pages fit phones and desktops with accessible content in both themes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const theme of ['light', 'dark']) {
        await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      }
    }
  }
});
