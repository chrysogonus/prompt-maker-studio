import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const source = 'Plan a 3-day trip to Lisbon. Give me a daily itinerary.';
const conversion = {
  fields: [
    { name: 'Task', content: 'Plan a {{duration}} trip to {{destination}}.' },
    { name: 'Format', content: 'Give me a daily itinerary.' },
  ],
  variables: [
    { name: 'duration', value: '3-day', description: 'Trip length', source_text: '3-day' },
    { name: 'destination', value: 'Lisbon', description: 'Destination', source_text: 'Lisbon' },
  ],
};
const filled = '<TASK>\nPlan a 3-day trip to Lisbon.\n</TASK>\n\n<FORMAT>\nGive me a daily itinerary.\n</FORMAT>';

async function register(page: Page) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#username').fill(`paste${suffix}`);
  await page.locator('#password').fill('E2ePass123!');
  await page.locator('#reg-email').fill(`paste${suffix}@example.com`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.route('**/api/prompts/config', (route) => route.fulfill({ json: {
    provider_connected: true, provider: 'ollama', provider_label: 'Ollama', model: 'local',
    available_models: [], budget_exhausted: false, global_budget_remaining_usd: null,
  } }));
}

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`converts, reviews, recovers and saves at ${width}px (${theme})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await register(page);
      let calls = 0;
      await page.route('**/api/prompts/parse-text', (route) => {
        calls++;
        expect(route.request().postDataJSON()).toEqual({ text: source, extract_variables: true });
        return route.fulfill({ json: conversion });
      });
      await page.getByRole('link', { name: 'Paste a prompt', exact: true }).click();
      const paste = page.getByRole('dialog', { name: 'Paste a prompt', exact: true });
      await expect(paste).toContainText('Ollama / local');
      await expect(paste).toContainText('May incur provider charges');
      await paste.getByLabel('Prompt to convert').fill(source);
      await page.reload();
      await expect(paste.getByLabel('Prompt to convert')).toHaveValue(source);
      await paste.getByRole('button', { name: 'Create template' }).focus();
      await page.keyboard.press('Enter');
      const review = page.getByRole('dialog', { name: 'Review your template' });
      await expect(review.getByRole('heading', { name: 'Your template is ready to review' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(review.getByRole('button', { name: 'Use in editor' })).toBeFocused();
      await page.keyboard.press('Tab');
      expect(await review.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await expect(review.getByLabel('Converted prompt preview')).toHaveText(filled);
      await expect(review.getByRole('button', { name: 'Copy filled prompt' })).toBeInViewport();
      await expect(review.getByRole('checkbox', { name: 'Keep these inputs as examples' })).not.toBeChecked();
      await review.getByRole('button', { name: 'Copy filled prompt' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(filled);
      await review.getByLabel('Variable name for destination').fill('city');
      await review.getByRole('checkbox', { name: 'Use duration as a variable' }).uncheck();
      await review.getByRole('button', { name: 'Copy template' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Plan a 3-day trip to {{city}}.');
      // The staged result recovers without another billed AI call.
      await page.reload();
      await expect(review.getByLabel('Variable name for destination')).toHaveValue('city');
      await expect(review.getByRole('checkbox', { name: 'Use duration as a variable' })).not.toBeChecked();
      expect(calls).toBe(1);
      await review.getByRole('button', { name: 'Use in editor' }).focus();
      await page.keyboard.press('Tab');
      expect(await review.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await review.getByRole('button', { name: 'Close review' }).click();
      await expect(review).not.toBeVisible();
      await page.getByRole('button', { name: 'Paste a prompt', exact: true }).click();
      await expect(review.getByLabel('Variable name for destination')).toHaveValue('city');
      expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
      for (const button of await review.getByRole('button').all()) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await review.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`paste-review-${width}-${theme}.png`) });
      await review.getByRole('button', { name: 'Use in editor' }).click();
      await expect(page).toHaveURL(/\/editor\/new$/);
      await expect(page.getByLabel('city', { exact: true })).toHaveValue('Lisbon');
      await expect(page.getByLabel('city', { exact: true })).toBeFocused();
      if (width < 760) await expect(page.getByRole('tab', { name: 'Fill and copy' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByLabel('Prompt text')).toHaveText(filled);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByLabel('Task text')).toHaveValue('');
      await page.getByRole('button', { name: 'Paste a prompt', exact: true }).click();
      if (theme === 'dark') await review.getByRole('checkbox', { name: 'Keep these inputs as examples' }).check();
      await review.getByRole('button', { name: 'Use in editor' }).click();
      await page.reload();
      await expect(page.getByLabel('city', { exact: true })).toHaveValue('Lisbon');
      const saveResponse = page.waitForResponse((response) => response.url().endsWith('/api/prompts') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const save = page.getByRole('dialog', { name: 'Save prompt', exact: true });
      await save.getByLabel('Name', { exact: true }).fill('Converted travel prompt');
      await save.getByRole('button', { name: 'Save prompt' }).click();
      const persisted = await (await saveResponse).json();
      expect(persisted.fields[0].content).toBe('Plan a 3-day trip to {{city}}.');
      expect(persisted.variable_metadata.city.example ?? null).toBe(theme === 'dark' ? 'Lisbon' : null);
      await expect(page).toHaveURL(/\/editor\/\d+$/);
      await expect(page.getByLabel('city', { exact: true })).toHaveValue('Lisbon');
      await page.reload();
      await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
      await expect(page.getByLabel('city', { exact: true })).toHaveValue('Lisbon');
      await expect(page.getByText('Your unsaved changes were restored.')).not.toBeVisible();
      await page.getByRole('button', { name: 'Copy filled prompt' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(filled);
      await page.goto('/library');
      await expect(page.getByRole('link', { name: 'Paste a prompt', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Copy the Converted travel prompt template' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('{{city}}');
      await page.getByRole('link', { name: 'Fill and copy', exact: true }).click();
      await expect(page.getByLabel('city', { exact: true })).toHaveValue('Lisbon');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(calls).toBe(1);
    });
  }
}

test('shows pending conversion and errors without losing the source or double charging', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  let release!: () => void;
  let calls = 0;
  await page.route('**/api/prompts/parse-text', async (route) => {
    calls++;
    if (calls === 1) {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 502, json: { detail: 'Provider unavailable. Try again.' } });
    } else await route.fulfill({ json: conversion });
  });
  await page.getByRole('link', { name: 'Paste a prompt', exact: true }).click();
  const paste = page.getByRole('dialog', { name: 'Paste a prompt', exact: true });
  await paste.getByLabel('Prompt to convert').fill(source);
  await paste.getByRole('button', { name: 'Create template' }).click();
  await expect(paste.getByRole('button', { name: 'Creating template…' })).toBeDisabled();
  await expect(paste.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(paste).toBeVisible();
  release();
  await expect(paste.getByRole('alert')).toContainText('Provider unavailable');
  await expect(paste.getByLabel('Prompt to convert')).toHaveValue(source);
  await paste.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('dialog', { name: 'Review your template' })).toBeVisible();
  expect(calls).toBe(2);
});
