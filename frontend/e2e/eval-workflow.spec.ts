/**
 * Evaluate-tab workflow: build an eval set, run it, and inspect the results.
 *
 * The user is connected to a deliberately unreachable OpenAI-compatible
 * endpoint, so model calls fail without ever reaching a real provider; the run
 * engine captures that per-case ("Model run failed: …" results with no score),
 * which is exactly the graceful-degradation path asserted here.
 */
import { expect, test, type Page } from '@playwright/test';

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
    // NOTE: the backend's email validator rejects RFC 2606 reserved TLDs
    // (.test, .example, …) as "special-use", so use a normal-looking TLD.
    email: prefix + suffix + '@example.com',
  };
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

/**
 * Point the user at a custom OpenAI-compatible endpoint that refuses
 * connections. Every AI feature now resolves its client from the user's own
 * connection, so a run needs *a* connection to get past the "connect a
 * provider" guard — but it must never reach a real, billed provider from CI.
 */
async function connectUnreachableProvider(page: Page) {
  await page.goto('/settings');
  await page.getByLabel('Provider').selectOption('custom');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:9/v1');
  await page.getByLabel('Model').fill('e2e-unreachable-model');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByText('Connection saved.')).toBeVisible();
  // Settings has no "+ New prompt" entry point — return to the dashboard.
  await page.goto('/');
  await expect(page.getByRole('link', { name: '+ New prompt' })).toBeVisible();
}

test('adds an eval case, runs an evaluation, and sees the persisted results', async ({ page }) => {
  const user = uniqueUser('evalflow');
  const promptName = 'Eval E2E ' + user.username;

  await register(page, user);
  await connectUnreachableProvider(page);

  // Create and save a prompt so the Editor/Detail screen (with its Evaluate
  // tab) is available.
  await page.getByRole('link', { name: '+ New prompt' }).click();
  await page.getByPlaceholder(/field name/i).fill('goal');
  await page.getByPlaceholder(/enter content for this field/i).fill('Answer support questions');
  await page.getByRole('button', { name: 'Generate Prompt' }).click();
  await expect(page.locator('pre[aria-label]')).toContainText('<GOAL>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Prompt Name').fill(promptName);
  await page.getByLabel('Prompt Name').press('Enter');
  await expect(page).toHaveURL(/\/editor\/\d+$/);

  // Build the eval set: one rule case with substring + forbidden-term checks.
  await page.getByRole('button', { name: 'Evaluate' }).click();
  await expect(page.getByText('Eval set', { exact: true })).toBeVisible();
  await expect(page.getByText(/No eval cases yet/)).toBeVisible();

  await page.getByRole('button', { name: '+ Add case' }).click();
  const criteriaInput = page.getByPlaceholder(/e\.g\. refund/);
  await expect(criteriaInput).toBeVisible();
  const criteriaSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/api\/prompts\/\d+\/eval\/cases\/\d+$/.test(response.url()),
  );
  await criteriaInput.fill('refund, !sorry');
  // The criteria field persists through a debounced PATCH. Wait for the
  // persistence boundary rather than relying on an arbitrary sleep.
  await expect(page.getByText(/!text must not appear/)).toBeVisible();
  await criteriaSaved;

  // The case survives a reload (it is persisted server-side).
  await page.reload();
  await page.getByRole('button', { name: 'Evaluate' }).click();
  await expect(page.getByPlaceholder(/e\.g\. refund/)).toHaveValue('refund, !sorry');

  // Run the evaluation. The configured endpoint is unreachable, so the model
  // call fails per-case, but the run itself persists with a scoreless result.
  await page.getByRole('button', { name: /Run evaluation/ }).click();
  await expect(page.getByLabel(/Select run v\d+/)).toBeVisible();
  await expect(page.getByText(/Model run failed/)).toBeVisible();
  await expect(page.getByText('No score')).toBeVisible();

  // Removing the case returns the eval set to its empty state; run history
  // is retained.
  await page.getByLabel('Remove case').click();
  await expect(page.getByText(/No eval cases yet/)).toBeVisible();
  await expect(page.getByText(/Model run failed/)).toBeVisible();

  // An accepted AI proposal is named from the generator's short label, with the
  // rationale left in its own field. The generator call is stubbed so this runs
  // deterministically without an OpenAI key.
  const rationale =
    'This standard happy-path case tests that the prompt can produce a concise triage note including requested details.';
  await page.route('**/eval/cases/generate', (route) =>
    route.fulfill({
      json: {
        proposals: [
          {
            method: 'rule',
            name: 'Happy path: standard triage note',
            criteria: 'refund',
            variables: {},
            rationale,
          },
        ],
      },
    }),
  );

  await page.getByRole('button', { name: /Suggest eval cases/ }).click();
  await expect(page.getByText(rationale)).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();

  const caseName = page.getByLabel(/Case \d+ name/);
  await expect(caseName).toHaveValue('Happy path: standard triage note');
  // The defect crammed the rationale in here, hard-clipped at maxLength.
  await expect(caseName).not.toHaveValue(/requ$/);
});
