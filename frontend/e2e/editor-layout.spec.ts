import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const fields = [
  { name: 'Role', content: 'Write clear updates for busy stakeholders.' },
  { name: 'Context', content: 'Team: {{team}}\nWeek: {{week}}\nNotes: {{notes}}' },
  { name: 'Task', content: 'Lead with what shipped, then risks and next steps.' },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('prompt-maker-studio:client-session-expiry', String(Date.now() + 3_600_000)));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path === '/api/auth/me') json = { id: 1, username: 'alex', email: 'alex@example.com', created_at: '2026-10-01T10:00:00Z' };
    else if (path === '/api/auth/refresh') json = { expires_at: new Date(Date.now() + 3_600_000).toISOString() };
    else if (path === '/api/prompts/1') json = {
      id: 1, name: 'Weekly status update', fields, generated_prompt: '', folder: 'Work',
      created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
    };
    else if (path === '/api/prompts/config') json = {
      provider_connected: false, provider: null, provider_label: null, model: null,
      available_models: [], budget_exhausted: false, global_budget_remaining_usd: null,
    };
    else json = [];
    await route.fulfill({ json });
  });
});

test('keeps long library folder names inside the phone content area', async ({ page }) => {
  const folder = 'A long but valid folder name '.repeat(5).trim();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/prompts/saved', route => route.fulfill({ json: [{
    id: 1, name: 'Weekly status update', fields, generated_prompt: '', folder,
    created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  }] }));
  await page.goto('/library');
  const chip = page.getByRole('main').getByText(folder, { exact: true });
  await expect(chip).toBeVisible();
  const box = (await chip.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('keeps every library grid card and action inside the list between breakpoints', async ({ page }) => {
  await page.route('**/api/prompts/saved', route => route.fulfill({ json: Array.from({ length: 4 }, (_, i) => ({
    id: i + 1, name: i % 2 ? 'Customer_support_reply_with_an_unbroken_name' : `Reply ${i + 1}`, fields, generated_prompt: '',
    folder: 'Customer support', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  })) }));
  await page.goto('/library');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  for (const width of [390, 481, 518, 600, 680, 760, 761, 900]) {
    await page.setViewportSize({ width, height: 900 });
    const overflowing = await page.getByRole('main').locator('ul').first().evaluate(list => {
      const listRight = list.getBoundingClientRect().right + 0.5;
      return [...list.querySelectorAll('li, li a, li button')]
        .map(element => element.getBoundingClientRect().right)
        .filter(right => right > listRight)
        .map(Math.round);
    });
    expect(overflowing, `cards or controls past the list at ${width}px`).toEqual([]);
  }
});

for (const theme of ['light', 'dark']) {
  test(`keeps the sidebar in view while a long library scrolls in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 720 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.route('**/api/prompts/saved', route => route.fulfill({ json: Array.from({ length: 40 }, (_, i) => ({
      id: i + 1, name: `Prompt ${i + 1}`, fields, generated_prompt: '', folder: 'Work',
      created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
    })) }));
    await page.goto('/library');
    await expect(page.getByRole('main').getByText('Prompt 40')).toBeAttached();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    const sidebar = (await page.getByRole('complementary', { name: 'Sidebar' }).boundingBox())!;
    expect(sidebar.y).toBeGreaterThanOrEqual(0);
    expect(sidebar.y).toBeLessThanOrEqual(12);
  });
}

for (const theme of ['light', 'dark']) {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    test(`keeps the prompt and copy action in view at ${viewport.width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      await page.goto('/editor/1?mode=filled');
      const preview = page.getByRole('complementary', { name: 'Preview', exact: true });
      await expect(preview).toBeVisible();
      const previewBox = (await preview.boundingBox())!;
      expect(previewBox.y).toBeLessThan(viewport.width > 760 ? 140 : 220);
      const textBox = (await page.getByLabel('Prompt text').boundingBox())!;
      expect(textBox.height).toBeGreaterThanOrEqual(160);
      const copyBox = (await page.getByRole('button', { name: 'Copy filled prompt' }).boundingBox())!;
      expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Tools', exact: true }).click();
      await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Tools', exact: true })).toBeFocused();
      await page.getByText('Test with AI', { exact: true }).click();
      await expect(page.getByRole('button', { name: 'Try once', exact: true })).toBeDisabled();
      await expect(preview.getByText(/Connect an AI provider in Settings/)).toBeVisible();
      await page.getByText('Test with AI', { exact: true }).click();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`editor-${theme}-${viewport.width}.png`) });
    });
  }
}
