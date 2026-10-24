import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const paths = [
  '/tools',
  '/tools/prompt-template-filler',
  '/tools/prompt-linter',
  '/tools/prompt-diff',
  '/tools/token-counter',
  '/tools/prompt-refiner',
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
      expect(html).toContain(path.endsWith('prompt-refiner')
        ? 'your prompt is sent to its AI provider' : 'Runs in your browser; nothing is uploaded.');
      expect(html).toContain('"@type":"FAQPage"');
    }
  }
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of paths) expect(sitemap).toContain(`${path}</loc>`);
});

test('the refiner says when it is off, and refines after the checker hands over a prompt', async ({ page }) => {
  // The e2e stack leaves PUBLIC_REFINE_ENABLED unset.
  await page.goto('/tools/prompt-refiner');
  await expect(page.getByRole('status')).toContainText('not offered on this server');

  const sent: unknown[] = [];
  await page.route('**/api/public/refine', (route) => route.fulfill({ json: { available: true, max_chars: 8000 } }));
  await page.route('**/api/public/refine/questions', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { questions: ['Who reads it?'] } });
  });
  await page.route('**/api/public/refine/draft', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { text: 'You are an editor. Summarize this article about {{topic}} in five bullets.' } });
  });
  await page.goto('/tools/prompt-linter');
  await page.getByRole('link', { name: 'Refine this prompt' }).click();
  await expect(page).toHaveURL(/\/tools\/prompt-refiner$/);
  await expect(page.getByRole('textbox', { name: 'Your prompt' })).toHaveValue('Summarize this article about {{topic}}.');
  await page.getByRole('button', { name: 'Ask me questions first' }).click();
  await page.getByRole('textbox', { name: 'Who reads it?' }).fill('Product managers');
  await page.getByRole('button', { name: 'Refine with my answers' }).click();
  await expect(page.getByLabel('Changes from your prompt')).toContainText('five bullets');
  expect(sent).toEqual([
    { text: 'Summarize this article about {{topic}}.', website: '', force: false },
    { text: 'Summarize this article about {{topic}}.', website: '', qa_pairs: [{ question: 'Who reads it?', answer: 'Product managers' }] },
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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
  await expect(page.getByRole('status')).toContainText('Sign in or create a free account to save your prompt to your library.');
  await expect(page.getByRole('link', { name: 'Go back without signing in' })).toHaveAttribute('href', '/tools/prompt-template-filler');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#username').fill(`tools${suffix}`);
  await page.locator('#password').fill('E2ePass123!');
  await page.locator('#reg-email').fill(`tools${suffix}@example.com`);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Already structured: straight into the draft, no review.
  await expect(page.getByText('Imported 1 section into draft—save to keep.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('customer_name', { exact: true })).toHaveValue('Dana');
  await expect(page.getByLabel('Task text')).toHaveValue(/\{\{customer_name\}\}/);
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
