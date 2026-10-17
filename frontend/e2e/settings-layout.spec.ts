import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Matches the shell's 760px phone breakpoint, where the sidebar becomes a drawer.
const PHONE_MAX_WIDTH = 760;
// The link must sit inside the sidebar column, not the page content.
const SIDEBAR_MAX_X = 248;

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('prompt-maker-studio:client-session-expiry', String(Date.now() + 3_600_000));
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === '/api/auth/me') body = {
      id: 1, username: 'alex', email: 'alex@example.com', default_library_view: 'list', created_at: '2026-10-01T10:00:00Z',
    };
    else if (path === '/api/prompts/saved') body = [];
    else if (path === '/api/auth/me/llm-connection') body = {
      configured: true, provider: 'openai', provider_label: 'OpenAI',
      base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', has_api_key: true, api_key_hint: '…1234',
      providers: [{ handle: 'openai', label: 'OpenAI', default_base_url: 'https://api.openai.com/v1', requires_api_key: true, suggested_models: ['gpt-6.1-sol'], models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', input_price_per_1m: 2, output_price_per_1m: 10 }], docs_url: null }],
    };
    else if (path.endsWith('/llm-connection/models')) body = [];
    else body = { detail: 'Unexpected test request' };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
});

test('sidebar source link and settings controls remain accessible across sizes and themes', async ({ page }, testInfo) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeVisible();
  await expect(page.getByText(/Previously configured model: gpt-4.1-mini/)).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    for (const width of [1440, 900, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width <= PHONE_MAX_WIDTH) await page.getByRole('button', { name: 'Open navigation' }).click();
      const link = page.getByRole('link', { name: 'Open source on GitHub' });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', 'https://github.com/chrysogonus/prompt-maker-studio');
      const linkBox = (await link.boundingBox())!;
      expect(linkBox.x).toBeLessThan(SIDEBAR_MAX_X);
      expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(900);
      if (width <= PHONE_MAX_WIDTH) await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width >= 900) {
        const controls = await Promise.all([
          page.getByRole('button', { name: 'Edit username' }).boundingBox(),
          page.getByRole('button', { name: 'Edit email' }).boundingBox(),
          page.getByRole('button', { name: 'Change password' }).boundingBox(),
          page.getByRole('radiogroup', { name: 'Theme' }).boundingBox(),
          page.getByRole('radiogroup', { name: 'Default library view' }).boundingBox(),
          page.getByRole('combobox', { name: 'Provider', exact: true }).boundingBox(),
          page.getByRole('textbox', { name: 'Base URL', exact: true }).boundingBox(),
          page.getByRole('button', { name: 'Save connection' }).boundingBox(),
          page.getByRole('button', { name: 'Export all prompts' }).boundingBox(),
          page.getByRole('button', { name: 'Delete account…' }).boundingBox(),
        ]);
        const positions = controls.map((box) => box!.x);
        expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
      }
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(audit.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`settings-${theme}-${width}.png`), fullPage: true });
    }
  }
});

test('expanded settings forms fit narrow screens and keep a common input edge', async ({ page }, testInfo) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Edit username' }).click();
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByRole('button', { name: 'Delete account…' }).click();
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('textbox', { name: 'New username' })).toBeVisible();
    const input = (await page.getByRole('textbox', { name: 'New username' }).boundingBox())!;
    const provider = (await page.getByRole('combobox', { name: 'Provider', exact: true }).boundingBox())!;
    expect(Math.abs(input.x - provider.x)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`settings-expanded-${width}.png`), fullPage: true });
  }
});

test('sign-in keeps the highlighted repository link clear of the form', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.removeItem('prompt-maker-studio:client-session-expiry'));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    const link = (await page.getByRole('link', { name: 'Open source on GitHub' }).boundingBox())!;
    const content = (await page.getByRole('main').boundingBox())!;
    expect(link.y + link.height).toBeLessThan(content.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`sign-in-${width}.png`), fullPage: true });
  }
});
