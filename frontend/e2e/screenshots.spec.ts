/**
 * Captures the screenshots embedded in the root README.
 *
 * Not part of the CI E2E suite — `playwright.config.ts` excludes this file via
 * `testIgnore`, because it writes into the repository rather than asserting
 * product behaviour. Run it deliberately with `make screenshots`.
 *
 * The Compose workflow seeds the documented `alex` demo account into a
 * disposable database, and everything shown comes from the real local
 * application. Only Paste a prompt's provider-backed calls (the capability check
 * and the import itself) are fulfilled in the browser, so the run is
 * deterministic and never contacts an LLM provider.
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const ASSET_DIR = path.resolve(__dirname, '../../docs/assets');
const VIEWPORT = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const USER = { username: 'alex', password: 'test1234' };

const IMPORT_TEXT =
  'Write a short, warm reply to a customer whose order is late. Say what happens next ' +
  'and keep it under 120 words.';

const IMPORT_FIELDS = [
  { name: 'Role', content: 'You write short, warm customer-support replies.' },
  { name: 'Task', content: 'Reply to {{customer_name}} about their late order. Say what happens next.' },
  { name: 'Format', content: 'Under 120 words. No apologies longer than one sentence.' },
];

const PROVIDER_CONFIG = {
  provider_connected: true,
  provider: 'openai',
  provider_label: 'OpenAI',
  model: 'gpt-4.1-mini',
  available_models: ['gpt-4.1-mini'],
  budget_exhausted: false,
  global_budget_remaining_usd: null,
};

function sidebarLink(page: Page, name: string | RegExp) {
  return page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name });
}

async function shoot(page: Page, name: string) {
  // Park the pointer so no row or section shows its hover-only controls.
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.waitForLoadState('networkidle');
  // Lets responsive layout and late React state updates settle before pixels are read.
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(ASSET_DIR, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
}

test('captures the README screenshots', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.route('**/api/prompts/config', (route) => route.fulfill({ json: PROVIDER_CONFIG }));
  let importHits = 0;
  await page.route('**/api/prompts/parse-text', (route) => {
    importHits += 1;
    return route.fulfill({ json: { fields: IMPORT_FIELDS } });
  });

  // The sign-in screen, before any credentials are entered.
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('#username')).toHaveValue('');
  await shoot(page, 'login');

  await page.locator('#username').fill(USER.username);
  await page.locator('#password').fill(USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The library is the home page: folders, favorites and recent edits.
  await expect(page.getByRole('heading', { level: 1, name: 'All prompts' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Weekly status update', exact: true })).toBeVisible();
  await shoot(page, 'library');

  // A saved prompt being filled in, with the text ready to copy.
  await page.getByRole('link', { name: 'Weekly status update', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Filled' })).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('team', { exact: true }).fill('Payments');
  await page.getByLabel('week', { exact: true }).fill('6–10 Oct');
  await shoot(page, 'editor');

  // Comparing an earlier version with the current text.
  await page.getByRole('button', { name: 'History' }).click();
  const history = page.getByRole('complementary', { name: 'Version history' });
  await history.getByRole('button', { name: /^Version 1/ }).click();
  await expect(history.getByLabel('Changes since this version')).toBeVisible();
  await shoot(page, 'history');

  // A new prompt built from pasted text.
  await sidebarLink(page, 'New prompt').click();
  await page.getByRole('button', { name: 'Paste a prompt' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Paste a prompt' });
  await importDialog.getByLabel('Prompt to convert').fill(IMPORT_TEXT);
  await importDialog.getByRole('button', { name: 'Create template' }).click();
  await page.getByRole('dialog', { name: 'Review your template' }).getByRole('button', { name: 'Use in editor' }).click();
  await expect(page.getByLabel('Task text')).toHaveValue(/late order/);
  expect(importHits).toBe(1);
  await shoot(page, 'new-prompt');

  // On a phone, a saved prompt opens straight to filling it in.
  await page.setViewportSize(PHONE);
  await page.goto('/library');
  await page.getByRole('link', { name: 'Reply to a tricky email', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Fill and copy' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shoot(page, 'phone');
});
