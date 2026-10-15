import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const paths = [
  '/guides',
  '/guides/reusable-ai-prompts',
  '/guides/prompt-template-variables',
  '/guides/organize-chatgpt-prompts',
];

test('visitors can follow the guides from the homepage into the app', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Guides' }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await page.getByRole('link', { name: 'How to create reusable AI prompts', exact: true }).click();
  await expect(page).toHaveURL(/\/guides\/reusable-ai-prompts$/);
  await page.getByRole('region', { name: 'Keep learning' })
    .getByRole('link', { name: 'How to use variables in AI prompt templates' }).click();
  await expect(page).toHaveURL(/\/guides\/prompt-template-variables$/);
  await page.getByRole('region', { name: 'Keep learning' })
    .getByRole('link', { name: 'How to organize and reuse your ChatGPT prompts' }).click();
  await page.getByRole('link', { name: 'Open Prompt Maker Studio', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test('guides serve article text and unique metadata without JavaScript, even with a session cookie', async ({ request }) => {
  const titles = new Set<string>();
  for (const path of paths) {
    for (const withSession of [false, true]) {
      const headers: Record<string, string> = withSession ? { Cookie: 'access_token=public-guide-test-session' } : {};
      const response = await request.get(path, { headers, maxRedirects: 0 });
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain('<h1>');
      expect(html).toContain('href="/library"');
      expect(html).toMatch(new RegExp(`<link rel="canonical" href="https?://[^"\\s]+${path}"`));
      expect(html).toContain('name="description"');
      expect(html).toContain('property="og:title"');
      expect(html).toContain('name="twitter:card"');
      expect(html).not.toMatch(/(?:name="robots"[^>]*content="[^"]*noindex|name="robots"[^>]*content="[^"]*nofollow)/);
      expect(response.headers()['x-robots-tag'] ?? '').not.toContain('noindex');
      if (!withSession) titles.add(html.match(/<title>(.*?)<\/title>/)?.[1] ?? '');
    }
  }
  expect(titles.size).toBe(4);
  expect(titles.has('')).toBe(false);
});

test('guides fit phones and desktops with accessible content in both themes', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const theme of ['light', 'dark']) {
        await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations).toEqual([]);
      }
      if ((width === 1440 && path === '/guides') || (width === 320 && path.endsWith('prompt-template-variables'))) {
        await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'light'));
        await page.screenshot({ path: testInfo.outputPath(`guides-${width}.png`), fullPage: true });
      }
    }
  }
});
