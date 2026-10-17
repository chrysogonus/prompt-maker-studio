import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { EvalCase, EvalRun } from '../src/types/evaluation';

// Deterministic responses exercise the UI without making paid provider calls.
test.beforeEach(async ({ page }) => {
  // Audit the settled theme rather than colors midway through its transition.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('prompt-maker-studio:client-session-expiry', String(Date.now() + 3_600_000));
  });
  const prompt = {
    id: 1, name: 'Summarise release notes', folder: 'Work', is_favorite: false,
    fields: [{ name: 'Task', content: 'Summarise {{notes}} for {{audience}}.' }],
    generated_prompt: '<TASK>Summarise {{notes}} for {{audience}}.</TASK>',
    created_at: '2026-10-01T10:00:00', updated_at: '2026-10-12T10:00:00',
    variable_metadata: { notes: { type: 'text', description: 'What shipped this week?' }, audience: { type: 'text', description: 'Who is reading?' } },
  };
  let cases: EvalCase[] = [
    { id: 1, prompt_id: 1, name: 'A typical weekly release', method: 'rule', criteria: 'search, !sorry',
      variables: { notes: 'Faster search and a fix for duplicate notifications.', audience: 'Customers' },
      intentionally_empty: false, position: 0, created_at: '2026-10-12T10:00:00' },
    { id: 2, prompt_id: 1, name: 'Explain a technical change', method: 'judge', criteria: 'Describe the benefit in plain language. Avoid internal implementation details.',
      variables: { notes: 'We rebuilt the indexing pipeline.', audience: 'Customers' },
      intentionally_empty: false, position: 1, created_at: '2026-10-12T10:00:00' },
    { id: 3, prompt_id: 1, name: 'Check the tone', method: 'manual', criteria: null,
      variables: { notes: 'Fixed a bug that prevented exports.', audience: 'A customer who reported the issue' },
      intentionally_empty: false, position: 2, created_at: '2026-10-12T10:00:00' },
  ];
  let runs: EvalRun[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/me') return json({ id: 1, username: 'alex', email: 'alex@example.com', created_at: prompt.created_at });
    if (path === '/api/prompts/1') return json(prompt);
    if (path === '/api/prompts/saved') return json([prompt]);
    if (path === '/api/prompts/folders') return json(['Work']);
    if (path === '/api/prompts/1/versions') return json([]);
    if (path === '/api/prompts/config') return json({
      provider_connected: true, provider: 'openai', provider_label: 'OpenAI', model: 'gpt-4.1-mini',
      available_models: [], budget_exhausted: false, global_budget_remaining_usd: 12.5,
    });
    if (path === '/api/prompts/1/eval/cases') {
      if (method === 'GET') return json(cases);
      const created = { ...request.postDataJSON(), id: 10, prompt_id: 1, position: cases.length, created_at: prompt.updated_at } as EvalCase;
      cases = [...cases, created];
      return json(created);
    }
    if (/\/eval\/cases\/\d+$/.test(path)) {
      const id = Number(path.split('/').at(-1));
      if (method === 'DELETE') { cases = cases.filter((item) => item.id !== id); return route.fulfill({ status: 204 }); }
      cases = cases.map((item) => item.id === id ? { ...item, ...request.postDataJSON() } : item);
      return json(cases.find((item) => item.id === id));
    }
    if (path.endsWith('/eval/cases/generate')) return json({ proposals: [{
      method: 'rule', name: 'Very short notes', criteria: '!sorry', variables: { notes: 'Bug fixes.', audience: 'Customers' }, rationale: 'Checks that a short input still produces a useful summary.',
    }] });
    if (path.endsWith('/eval/runs')) {
      if (method === 'GET') return json(runs);
      const result: EvalRun = {
        id: 21 + runs.length, prompt_id: 1, prompt_version_number: 3, created_at: '2026-10-12T10:32:00', score: null,
        model: 'gpt-4.1-mini', total_latency_ms: 3200, total_prompt_tokens: 870, total_completion_tokens: 260, total_cost_usd: 0.0016,
        results: cases.map((item) => ({ id: item.id + 30, eval_case_id: item.id, method: item.method,
          label: item.name!, criteria: item.criteria, variables: item.variables, judge_model: item.method === 'judge' ? 'gpt-4.1-mini' : null,
          output_text: item.method === 'judge' ? 'Find what you need faster with improved search.' : 'Search is faster this week, and duplicate notifications have been fixed.',
          score: item.method === 'manual' ? null : item.method === 'judge' ? 84 : 100,
          is_pending: item.method === 'manual', rationale: item.method === 'judge' ? JSON.stringify({ text: 'Clear benefit, but the summary could give more context.', strengths: ['Plain language', 'Focuses on the customer'], weaknesses: ['A little too brief'] }) : item.method === 'manual' ? null : '2/2 checks passed.',
        })),
      };
      runs = [result, ...runs];
      return json(result);
    }
    if (path.endsWith('/rate')) {
      const id = Number(path.split('/').at(-2));
      runs = runs.map((item, index) => index === 0 ? ({ ...item, score: 91, results: item.results.map((result) => result.id === id ? { ...result, score: 80, is_pending: false, rationale: 'Manually rated 4/5 stars' } : result) }) : item);
      return json(runs[0]);
    }
    return json({ detail: 'Unexpected test request' }, 404);
  });
  await page.goto('/editor/1/evaluate');
  await expect(page.getByRole('heading', { name: 'Evaluate', exact: true })).toBeVisible();
});

test('cases, suggestions, explicit runs and manual ratings form one workflow', async ({ page }) => {
  await page.getByRole('button', { name: 'Suggest test cases', exact: true }).click();
  await page.getByLabel('Testing focus (optional)').fill('Very short input');
  await page.getByRole('button', { name: 'Generate suggestions' }).click();
  await page.getByRole('button', { name: 'Review and add Very short notes' }).click();
  await expect(page.getByRole('textbox', { name: 'Checks', exact: true })).toHaveValue('!sorry');
  await page.getByRole('button', { name: 'Save test case' }).click();
  await expect(page.getByRole('heading', { name: 'Very short notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Run evaluation', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Run history' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Awaiting your rating', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Rate 4 out of 5' }).click();
  await expect(page.getByText('Awaiting your rating', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Scored · 91/100' })).toBeVisible();
});

test('desktop and phone layouts stay accessible in both themes', async ({ page }, testInfo) => {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => { document.documentElement.setAttribute('data-theme', value); }, theme);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole('radio', { name: 'Test cases' }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`cases-${theme}-${viewport.width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Edit A typical weekly release' }).click();
      await expect(page.getByLabel('notes')).toBeVisible();
      const formAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(formAudit.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`form-${theme}-${viewport.width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Run evaluation', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Run history' })).toHaveAttribute('aria-checked', 'true');
      const resultsAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(resultsAudit.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`results-${theme}-${viewport.width}.png`), fullPage: true });
    }
  }
});

test('comparison keeps outputs readable on desktop and phones', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Run evaluation', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Run history' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Run evaluation', exact: true }).click();
  await page.getByRole('combobox', { name: 'Compare with' }).selectOption('21');
  await expect(page.getByRole('heading', { name: 'Compare outputs' })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => { document.documentElement.setAttribute('data-theme', value); }, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(audit.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`comparison-${theme}-${width}.png`), fullPage: true });
    }
  }
});

test('historical results show tested and current versions on desktop and phones', async ({ page }) => {
  await page.getByRole('button', { name: 'Run evaluation', exact: true }).click();
  await expect(page.getByText('Tested version 3. Current saved version 3.')).toBeVisible();
  await page.route('**/api/prompts/1/versions', (route) => route.fulfill({ json: [{
    id: 3, version_number: 3, note: null, author: null, fields: [], generated_prompt: '', created_at: '2026-10-12T10:00:00',
  }] }));
  await page.reload();
  await page.getByRole('radio', { name: 'Run history' }).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByText('Tested version 3. Current saved version 4.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run current version' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.route('**/api/prompts/1/eval/runs', (route) => route.fulfill({ json: {
    id: 99, prompt_id: 1, prompt_version_number: 4, created_at: '2026-10-12T11:00:00',
    score: null, model: 'gpt-4.1-mini', total_latency_ms: 1, total_prompt_tokens: 1,
    total_completion_tokens: 1, total_cost_usd: 0, results: [],
  } }));
  await page.getByRole('button', { name: 'Run current version' }).click();
  await expect(page.getByText('Tested version 4. Current saved version 4.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Past evaluations' }).getByRole('button')).toHaveCount(2);
});
