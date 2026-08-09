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
    email: prefix + suffix + '@example.com',
  };
}

function navLink(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('link', { name });
}

async function register(page: Page, user: TestUser) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.locator('#reg-email').fill(user.email);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText(`Good to see you, ${user.username}`)).toBeVisible();
}

/** Mirrors the app's own imperative theme toggle (see `(app)/layout.tsx`) rather than
 * driving the Settings UI, so each page visit doesn't need a detour through Settings. */
async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => localStorage.setItem('theme', t), theme);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

/**
 * Wait for entry animations to settle before measuring.
 *
 * axe derives contrast from the *composited* colour, so auditing a page while it
 * is still fading in reports every foreground blended with whatever sits behind
 * it. The login screen's `.authShell` reveals from `opacity: 0` over 600ms
 * (`src/components/AuthForm.module.css`); at the ~0.63 alpha it passes through,
 * all three tokens in the sample prompt card drop under 4.5:1 even though each
 * one clears it at rest. That is an artefact of when the snapshot was taken, and
 * it only reproduces on a machine slow enough to still be animating — the
 * heading-visible check every audit already does resolves long before the fade
 * ends, so the failure is a race, not a palette problem.
 *
 * Spinners and progress indicators animate forever by design, so they are
 * skipped rather than waited on — otherwise any page with one in flight would
 * hang here.
 */
async function settleAnimations(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const timing = animation.effect?.getComputedTiming();
      if (timing?.iterations === Infinity) {
        return true;
      }
      return animation.playState === 'finished' || animation.playState === 'idle';
    }),
  );
}

async function auditPage(page: Page, label: string) {
  await settleAnimations(page);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const minor = results.violations.filter(
    (v) => v.impact !== 'serious' && v.impact !== 'critical',
  );

  if (minor.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[a11y] ${label}: ${minor.length} minor/moderate finding(s) (not asserted): ` +
        minor.map((v) => v.id).join(', '),
    );
  }

  expect(serious, `${label}: ${JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.length })))}`).toEqual([]);
}

test.describe('accessibility audit', () => {
  test('login page has no serious a11y violations, in dark and light theme', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await auditPage(page, 'login (dark)');

    await setTheme(page, 'light');
    await auditPage(page, 'login (light)');
  });

  test('authenticated pages have no serious a11y violations, in dark and light theme', async ({
    page,
  }) => {
    const user = uniqueUser('a11y');
    const promptName = 'A11y Audit ' + user.username;

    await register(page, user);
    await auditPage(page, 'dashboard (dark)');

    await page.getByRole('link', { name: '+ New prompt' }).click();
    await expect(page).toHaveURL(/\/editor\/new$/);
    await auditPage(page, 'editor-new (dark)');

    await page.getByPlaceholder(/field name/i).fill('goal');
    await page.getByPlaceholder(/enter content for this field/i).fill('accessibility audit content');
    await page.getByRole('button', { name: 'Generate Prompt' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByLabel('Prompt Name').fill(promptName);
    await page.getByLabel('Prompt Name').press('Enter');
    await expect(page).toHaveURL(/\/editor\/\d+$/);
    await auditPage(page, 'editor-detail (dark)');

    await page.getByRole('link', { name: /test in playground/i }).click();
    await expect(page).toHaveURL(/\/playground\/\d+$/);
    await auditPage(page, 'playground (dark)');

    await navLink(page, 'Library').click();
    await expect(page).toHaveURL(/\/library$/);
    await auditPage(page, 'library (dark)');

    await navLink(page, 'Settings').click();
    await expect(page).toHaveURL(/\/settings$/);
    await auditPage(page, 'settings (dark)');

    await setTheme(page, 'light');

    await page.goto('/');
    await auditPage(page, 'dashboard (light)');

    await page.goto('/library');
    await auditPage(page, 'library (light)');

    await page.goto('/settings');
    await auditPage(page, 'settings (light)');
  });
});
