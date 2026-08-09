/**
 * Captures the seven screenshots embedded in the root README.
 *
 * Not part of the CI E2E suite — `playwright.config.ts` excludes this file via
 * `testIgnore`, because it writes into the repository rather than asserting
 * product behaviour. Run it deliberately with `make screenshots`.
 *
 * The Compose workflow seeds the documented `alex` demo fixture into a
 * disposable database. Authentication, navigation, prompt reads, prompt
 * generation, and eval-case writes all use the real local application. Only
 * provider-backed responses are fulfilled in the browser, so this scenario is
 * deterministic, costs nothing, and cannot contact an external LLM provider.
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

import type { EvalCase, EvalCaseCreateRequest, EvalRun } from '../src/types/prompt';

const ASSET_DIR = path.resolve(__dirname, '../../docs/assets');
const VIEWPORT = { width: 1440, height: 900 };

const USER = {
  username: 'alex',
  password: 'test1234',
};

const IMPORT_DESCRIPTION =
  'Draft a concise customer support reply for a delayed, time-sensitive order. ' +
  'Use a warm and accountable tone, provide a concrete tracking next step, and stay under 120 words.';

const IMPORT_FIELDS = [
  {
    name: 'audience',
    content: 'Customers waiting for a time-sensitive order that is already late.',
  },
  {
    name: 'task',
    content: 'Acknowledge the delay and give a concrete tracking and follow-up next step.',
  },
  {
    name: 'tone',
    content: 'Warm, accountable, reassuring, and concise; keep the reply under 120 words.',
  },
];

const REFINE_QUESTIONS = [
  'What should the customer be able to do immediately after reading the reply?',
  'Which wording or behavior should the response avoid?',
];

const REFINED_PROMPT = `<TONE>Warm, calm, and accountable</TONE>
<ISSUE>Late delivery</ISSUE>
<AUDIENCE>Customers awaiting time-sensitive orders</AUDIENCE>

Write a concise reply to {{customer_name}} about their {{issue_type}}. Acknowledge the delay without blaming the carrier, explain the next concrete step, and promise a response within {{response_time}} hours. Keep the message under 120 words.`;

const PROVIDER_CONFIG = {
  provider_connected: true,
  provider: 'openai',
  provider_label: 'OpenAI',
  model: 'gpt-4.1-mini',
  available_models: ['gpt-4.1-mini'],
  budget_exhausted: false,
  global_budget_remaining_usd: null,
};

const fixtureHits = {
  config: 0,
  import: 0,
  refineQuestions: 0,
  refineDraft: 0,
  evalRuns: 0,
};

/** The breadcrumb on Editor/Detail also links to "Library", so nav clicks must be scoped. */
function navLink(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('link', { name, exact: true });
}

async function installProviderFixtures(page: Page) {
  await page.route('**/api/prompts/config', (route) => {
    fixtureHits.config += 1;
    return route.fulfill({ json: PROVIDER_CONFIG });
  });
  await page.route('**/api/prompts/parse-text', (route) => {
    fixtureHits.import += 1;
    return route.fulfill({ json: { fields: IMPORT_FIELDS } });
  });
}

async function shoot(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.waitForLoadState('networkidle');
  // Reduced motion is set for the whole scenario; this short pause also lets
  // responsive layout and late React state updates settle before pixels are read.
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(ASSET_DIR, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
}

async function signIn(page: Page) {
  await page.locator('#username').fill(USER.username);
  await page.locator('#password').fill(USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: `Good to see you, ${USER.username}` })).toBeVisible();
}

async function createEvalCases(page: Page, promptId: number): Promise<EvalCase[]> {
  const cases: EvalCaseCreateRequest[] = [
    {
      method: 'rule',
      name: 'Apology and next step',
      criteria: 'apologize, next step, !blame',
      variables: {
        customer_name: 'Jordan',
        issue_type: 'late express delivery',
        response_time: '4',
      },
    },
    {
      method: 'judge',
      name: 'Warm and actionable tone',
      criteria: 'Sound accountable and empathetic while giving a specific, useful next action.',
      variables: {
        customer_name: 'Morgan',
        issue_type: 'missed delivery window',
        response_time: '2',
      },
    },
  ];

  // Same-origin `/api`, exactly like the app's own calls (src/lib/apiBase.ts).
  // This runs inside the page, so an absolute backend origin would be a
  // cross-origin request: CORS rejects it and the page's `connect-src 'self'`
  // would too, surfacing only as "TypeError: Failed to fetch".
  return page.evaluate(
    async ({ targetPromptId, requests }) => {
      const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
      const csrfToken = match ? decodeURIComponent(match[1]) : '';
      const created = [];

      for (const request of requests) {
        const response = await fetch(`/api/prompts/${targetPromptId}/eval/cases`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify(request),
        });
        if (!response.ok) {
          throw new Error(`Failed to create screenshot eval case: ${response.status}`);
        }
        created.push(await response.json());
      }

      return created;
    },
    { targetPromptId: promptId, requests: cases },
  );
}

function evalRunFixtures(promptId: number, cases: EvalCase[]): EvalRun[] {
  const [ruleCase, judgeCase] = cases;
  if (!ruleCase || !judgeCase) throw new Error('Evaluation screenshot needs two real cases.');

  const earlier: EvalRun = {
    id: 901,
    prompt_id: promptId,
    prompt_version_number: 2,
    score: 76,
    created_at: '2026-07-30T12:00:00Z',
    model: 'gpt-4.1-mini',
    total_latency_ms: 2480,
    total_prompt_tokens: 612,
    total_completion_tokens: 238,
    total_cost_usd: 0.00184,
    results: [
      {
        id: 9101,
        eval_case_id: ruleCase.id,
        method: 'rule',
        label: ruleCase.name ?? 'Apology and next step',
        criteria: ruleCase.criteria,
        variables: ruleCase.variables,
        rationale: '2 of 3 exact checks passed.',
        score: 67,
        is_pending: false,
        output_text: 'I apologize for the delay. We are checking the tracking details now.',
      },
      {
        id: 9102,
        eval_case_id: judgeCase.id,
        method: 'judge',
        label: judgeCase.name ?? 'Warm and actionable tone',
        criteria: judgeCase.criteria,
        variables: judgeCase.variables,
        rationale: JSON.stringify({
          text: 'Empathetic, but the next action is still vague.',
          strengths: ['accountable tone'],
          weaknesses: ['unclear follow-up'],
        }),
        score: 85,
        is_pending: false,
        output_text: 'I am sorry this missed the promised window. We are reviewing it now.',
        judge_model: 'gpt-4.1-mini',
      },
    ],
  };

  const latest: EvalRun = {
    id: 902,
    prompt_id: promptId,
    prompt_version_number: 3,
    score: 94,
    created_at: '2026-08-01T12:00:00Z',
    model: 'gpt-4.1-mini',
    total_latency_ms: 2115,
    total_prompt_tokens: 648,
    total_completion_tokens: 226,
    total_cost_usd: 0.00171,
    results: [
      {
        id: 9201,
        eval_case_id: ruleCase.id,
        method: 'rule',
        label: ruleCase.name ?? 'Apology and next step',
        criteria: ruleCase.criteria,
        variables: ruleCase.variables,
        rationale: 'All 3 exact checks passed.',
        score: 100,
        is_pending: false,
        output_text: 'I apologize for the delay. Your next step is to open the tracking link below.',
      },
      {
        id: 9202,
        eval_case_id: judgeCase.id,
        method: 'judge',
        label: judgeCase.name ?? 'Warm and actionable tone',
        criteria: judgeCase.criteria,
        variables: judgeCase.variables,
        rationale: JSON.stringify({
          text: 'Warm, accountable, and specific about the follow-up.',
          strengths: ['clear action', 'concise'],
          weaknesses: [],
        }),
        score: 88,
        is_pending: false,
        output_text: 'I am sorry we missed the window. Check tracking now; we will follow up in two hours.',
        judge_model: 'gpt-4.1-mini',
      },
    ],
  };

  // The API returns newest first; the UI sorts selected runs chronologically
  // when it builds the side-by-side comparison.
  return [latest, earlier];
}

test('captures the README screenshots', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('density', 'comfortable');
  });
  await installProviderFixtures(page);

  // Clean, unauthenticated access screen. Capture before credentials are entered.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#username')).toHaveValue('');
  await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  await expect(page.locator('#password')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await shoot(page, 'login');

  await signIn(page);

  // Seeded analytics, chart, ranked usage, and favorites all come from the real backend.
  await expect(page.getByText('Runs this month')).toBeVisible();
  const requestChart = page.getByRole('heading', { name: 'Requests, last 7 days' }).locator('..');
  await expect(requestChart.locator('[title]')).toHaveCount(7);
  await expect(requestChart.locator('[title]').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top prompts by usage' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Support Customer Support Reply/ })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Marketing Product Launch Announcement/ }),
  ).toBeVisible();
  await shoot(page, 'dashboard');

  // Provider-backed parsing is synthetic; field editing and local prompt generation are real.
  await navLink(page, 'Editor').click();
  await expect(page).toHaveURL(/\/editor\/new$/);
  await expect(page.getByRole('heading', { name: 'New prompt' })).toBeVisible();
  await page.getByLabel('Describe your prompt').fill(IMPORT_DESCRIPTION);
  await page.getByRole('button', { name: 'Parse & Import Fields' }).click();
  await expect(page.getByText('Imported 3 fields into Prompt Configuration')).toBeVisible();
  await expect(page.getByLabel('Field 1 name')).toHaveValue('audience');
  await expect(page.getByLabel('Field 2 name')).toHaveValue('task');
  await expect(page.getByLabel('Field 3 name')).toHaveValue('tone');
  await page.getByRole('button', { name: 'Generate Prompt' }).click();
  const generatedPreview = page.locator('pre[aria-label]');
  await expect(generatedPreview).toContainText('<AUDIENCE>');
  await expect(generatedPreview).toContainText('<TASK>');
  await expect(generatedPreview).toContainText('<TONE>');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByText('Imported 3 fields into Prompt Configuration')).toBeVisible();
  await expect(generatedPreview).toBeVisible();
  await shoot(page, 'new-prompt');

  // The seeded Library stays real. Filter to Support so favorite state, tags,
  // run counts, and actions are all legible together in the viewport.
  await navLink(page, 'Library').click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { name: 'Prompt library' })).toBeVisible();
  await page.getByRole('button', { name: 'support', exact: true }).click();
  await expect(page.getByText('Showing 3 of 8')).toBeVisible();
  const supportReplyCard = page.getByRole('group').filter({ hasText: 'Customer Support Reply' });
  await expect(supportReplyCard).toBeVisible();
  await expect(supportReplyCard.getByText('6 runs')).toBeVisible();
  await expect(supportReplyCard.getByRole('button', { name: 'Unfavorite Customer Support Reply' })).toBeVisible();
  await expect(supportReplyCard.getByRole('button', { name: 'Rename Customer Support Reply' })).toBeVisible();
  await expect(supportReplyCard.getByRole('button', { name: 'Duplicate Customer Support Reply' })).toBeVisible();
  await expect(supportReplyCard.getByRole('button', { name: 'Delete Customer Support Reply' })).toBeVisible();
  const escalationCard = page.getByRole('group').filter({ hasText: 'Escalation Notice' });
  await expect(escalationCard.getByText('urgent', { exact: true })).toBeVisible();
  await shoot(page, 'library');

  // Open the seeded prompt through the real Library card and retain its real id.
  await supportReplyCard.getByRole('heading', { name: 'Customer Support Reply' }).click();
  await expect(page).toHaveURL(/\/editor\/\d+$/);
  const promptId = Number(new URL(page.url()).pathname.split('/').at(-1));
  expect(promptId).toBeGreaterThan(0);

  await expect(page.getByRole('heading', { name: 'Customer Support Reply' })).toBeVisible();
  await expect(page.getByLabel('Prompt template')).toHaveValue(/customer_name/);
  await expect(page.getByLabel('customer_name type')).toHaveValue('text');
  await expect(page.getByLabel('customer_name description')).toHaveValue(
    'Name of the customer being replied to',
  );
  await expect(page.getByLabel('response_time type')).toHaveValue('number');
  await expect(page.getByRole('button', { name: 'Remove tag support' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove tag email' })).toBeVisible();
  await expect(page.getByText('total runs')).toBeVisible();
  await expect(page.getByText('v1', { exact: true })).toBeVisible();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Snippet language' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wrap lines' })).toBeVisible();
  await shoot(page, 'editor');

  // Clarification and draft calls are provider-backed browser fixtures. The
  // prompt itself remains untouched because the capture stops before Accept.
  await page.route(`**/api/prompts/${promptId}/refine/questions**`, (route) => {
    fixtureHits.refineQuestions += 1;
    return route.fulfill({ json: { questions: REFINE_QUESTIONS } });
  });
  await page.route(`**/api/prompts/${promptId}/refine/draft`, (route) => {
    fixtureHits.refineDraft += 1;
    return route.fulfill({ json: { draft: REFINED_PROMPT } });
  });
  await page.getByRole('button', { name: 'Refine' }).click();
  await page.getByRole('button', { name: 'Ask for clarification' }).click();
  await expect(page.getByText(REFINE_QUESTIONS[0])).toBeVisible();
  await page.locator('#answer-input-0').fill(
    'Open the tracking link now and know exactly when support will follow up.',
  );
  await page.locator('#answer-input-1').fill(
    'Avoid blaming the carrier, vague reassurance, and overly long explanations.',
  );
  await page.getByRole('button', { name: 'Generate suggestion' }).click();
  const proposalDiff = page.getByLabel('Proposed changes diff');
  await expect(page.getByRole('heading', { name: 'Review your refined prompt' })).toBeVisible();
  await expect(page.getByText('Not saved yet')).toBeVisible();
  await expect(proposalDiff).toBeVisible();
  await expect(proposalDiff).toContainText('time-sensitive orders');
  await expect(page.getByRole('button', { name: 'View diff' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Accept & update prompt' })).toBeVisible();
  await page.getByRole('heading', { name: 'Review your refined prompt' }).scrollIntoViewIfNeeded();
  await shoot(page, 'refine');

  // Eval cases are real application records. Only the provider-derived run
  // results are supplied by the browser fixture, newest-first like the API.
  const evalCases = await createEvalCases(page, promptId);
  expect(evalCases).toHaveLength(2);
  const evalRuns = evalRunFixtures(promptId, evalCases);
  await page.route(`**/api/prompts/${promptId}/eval/runs`, (route) => {
    fixtureHits.evalRuns += 1;
    return route.fulfill({ json: route.request().method() === 'GET' ? evalRuns : evalRuns[0] });
  });
  await page.getByRole('button', { name: 'Evaluate' }).click();
  const evalSet = page.getByRole('region', { name: 'Eval set' });
  await expect(evalSet).toBeVisible();
  await expect(evalSet.getByText('2 / 20 cases')).toBeVisible();
  await expect(evalSet.getByText('Apology and next step', { exact: true })).toBeVisible();
  await expect(evalSet.getByText('Warm and actionable tone', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Run history' })).toBeVisible();
  await expect(page.getByText('2 runs')).toBeVisible();
  await page.getByLabel(/Select run v2 .* for details or comparison/).check();
  await expect(page.getByLabel(/Select run v2 .* for details or comparison/)).toBeChecked();
  await expect(page.getByLabel(/Select run v3 .* for details or comparison/)).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Comparing v2 → v3' })).toBeVisible();
  await expect(page.getByText('Δ score +33', { exact: true })).toBeVisible();
  await expect(page.getByText('Δ score +3', { exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Run history' }).scrollIntoViewIfNeeded();
  await shoot(page, 'evaluation');

  expect(fixtureHits.import).toBe(1);
  expect(fixtureHits.refineQuestions).toBe(1);
  expect(fixtureHits.refineDraft).toBe(1);
  expect(fixtureHits.evalRuns).toBeGreaterThanOrEqual(1);
  expect(fixtureHits.config).toBeGreaterThanOrEqual(1);
});
