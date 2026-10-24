import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EvaluationPage from '../EvaluationPage';
import { ApiClient, ApiError } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import type { EvalCase, EvalRun } from '@/types/evaluation';

vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  ApiClient: Object.fromEntries([
    'getPromptById', 'getPromptVersions', 'getPromptsConfig', 'getEvalCases', 'getEvalRuns', 'createEvalCase',
    'updateEvalCase', 'deleteEvalCase', 'importEvalCases', 'exportEvalCases',
    'generateEvalCases', 'runEvaluation', 'rateEvalResult',
  ].map((name) => [name, vi.fn()])),
}));
vi.mock('@/lib/download', () => ({ downloadBlob: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ currentUser: 'alex' }) }));

const example: EvalCase = {
  id: 4, prompt_id: 1, method: 'rule', name: 'Returns JSON', criteria: '{json}',
  variables: { topic: 'Release notes' }, intentionally_empty: false, position: 0,
  created_at: '2026-10-01T10:00:00',
};
const run: EvalRun = {
  id: 12, prompt_id: 1, prompt_version_number: 2, tested_version: 2, matches_current: false, tested_prompt: null, score: null, created_at: '2026-10-12T10:00:00',
  model: 'example-model', total_latency_ms: 2200, total_prompt_tokens: 120,
  total_completion_tokens: 40, total_cost_usd: 0.0012,
  results: [{ id: 19, eval_case_id: 4, method: 'manual', label: 'Review tone',
    rationale: null, score: null, human_score: null, is_pending: true, output_text: 'Clear release notes.',
    criteria: null, variables: { topic: 'Release notes' }, judge_model: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue({
    id: 1, name: 'Release notes', fields: [{ name: 'Task', content: 'Write about {{topic}}' }],
    generated_prompt: '<TASK>Write about {{topic}}</TASK>', created_at: '2026-10-01T10:00:00',
    variable_metadata: { topic: { type: 'text', description: 'What changed?' } },
  });
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: true, provider: 'custom', provider_label: 'Custom', model: 'example-model',
    available_models: [], budget_exhausted: false, global_budget_remaining_usd: null,
  });
  vi.mocked(ApiClient.getEvalCases).mockResolvedValue([]);
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([]);
  vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([]);
  vi.mocked(ApiClient.createEvalCase).mockResolvedValue(example);
  vi.mocked(ApiClient.updateEvalCase).mockResolvedValue({ ...example, name: 'Updated case' });
  vi.mocked(ApiClient.runEvaluation).mockResolvedValue(run);
});

async function open(cases: EvalCase[] = []) {
  vi.mocked(ApiClient.getEvalCases).mockResolvedValue(cases);
  render(<EvaluationPage promptId={1} />);
  await screen.findByRole('heading', { name: 'Evaluate' });
}

it('loads older evaluation pages without replacing current history', async () => {
  const user = userEvent.setup();
  const recent = Array.from({ length: 50 }, (_, index) => ({ ...run, id: 100 - index }));
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValueOnce(recent).mockResolvedValueOnce([run]);
  await open();
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  const history = screen.getByRole('navigation', { name: 'Past evaluations' });
  expect(within(history).getAllByRole('button')).toHaveLength(51);
  await user.click(screen.getByRole('button', { name: 'Load older evaluations' }));
  await waitFor(() => expect(within(history).getAllByRole('button')).toHaveLength(51));
  expect(ApiClient.getEvalRuns).toHaveBeenLastCalledWith(1, 50, 50);
  expect(screen.queryByRole('button', { name: 'Load older evaluations' })).not.toBeInTheDocument();
});

it('keeps cases and history usable after a config failure and retries capability independently', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getPromptsConfig).mockRejectedValueOnce(new Error('Config unavailable'));
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([run]);
  await open([example]);
  expect(screen.getByRole('alert')).toHaveTextContent('AI availability could not be checked. You can still manage cases and read past results.');
  expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Edit Returns JSON' }));
  expect(screen.getByLabelText('Checks')).toHaveValue('{json}');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  expect(screen.getByText('Clear release notes.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry AI availability' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeEnabled());
  expect(ApiClient.getPromptById).toHaveBeenCalledTimes(1);
  expect(ApiClient.runEvaluation).not.toHaveBeenCalled();
});

it('labels historical results with tested and current versions and runs current without discarding history', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([run]);
  vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([{ id: 1, version_number: 3, note: null, author: null, fields: [], generated_prompt: '', created_at: '' }]);
  vi.mocked(ApiClient.runEvaluation).mockResolvedValue({ ...run, id: 13, prompt_version_number: 4, tested_version: 4, matches_current: true });
  await open([example]);
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  expect(screen.getByText('Tested version 2. Current saved version 4.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Run current version' }));
  await screen.findByText('Tested version 4. Current saved version 4.');
  expect(within(screen.getByRole('navigation', { name: 'Past evaluations' })).getAllByRole('button')).toHaveLength(2);
});

it('labels an unsaved draft run and hides Run current version when the text is current', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([
    { ...run, prompt_version_number: 0, tested_version: null },
    { ...run, id: 11, tested_version: 3, matches_current: true },
  ]);
  vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([{ id: 1, version_number: 4, note: null, author: null, fields: [], generated_prompt: '', created_at: '' }]);
  await open([example]);
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  expect(screen.getByText('Tested an unsaved draft. Current saved version 5.')).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Past evaluations' })).getByText('Unsaved draft')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run current version' })).toBeInTheDocument();
  await user.click(within(screen.getByRole('navigation', { name: 'Past evaluations' })).getByText('Version 3'));
  expect(screen.getByText('Tested version 3. Current saved version 5, with the same text.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Run current version' })).not.toBeInTheDocument();
});

it('explains an empty evaluation and never starts a paid call automatically', async () => {
  await open();
  expect(screen.getByText('Try your prompt with a few examples.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Back to editor' })).toHaveAttribute('href', '/editor/1');
  expect(ApiClient.runEvaluation).not.toHaveBeenCalled();
  expect(ApiClient.generateEvalCases).not.toHaveBeenCalled();
});

it('creates a case with variable values and clear scoring instructions', async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole('button', { name: 'Add test case' }));
  await user.type(screen.getByLabelText('Name (optional)'), 'Returns JSON');
  await user.type(screen.getByLabelText('topic'), 'Release notes');
  await user.selectOptions(screen.getByLabelText('Check 1'), 'json');
  await user.click(screen.getByRole('button', { name: 'Save test case' }));
  await screen.findByRole('heading', { name: 'Returns JSON' });
  expect(ApiClient.createEvalCase).toHaveBeenCalledWith(1, {
    name: 'Returns JSON', method: 'rule', criteria: '{json}', variables: { topic: 'Release notes' },
    intentionally_empty: false,
  });
  expect(ApiClient.runEvaluation).not.toHaveBeenCalled();
});

it('keeps failed edits on screen and sends empty strings when clearing stored fields', async () => {
  const user = userEvent.setup();
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Edit Returns JSON' }));
  await user.clear(screen.getByLabelText('Name (optional)'));
  await user.selectOptions(screen.getByLabelText('Scoring'), 'manual');
  vi.mocked(ApiClient.updateEvalCase).mockRejectedValueOnce(new Error('Could not save'));
  await user.click(screen.getByRole('button', { name: 'Save test case' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.getByLabelText('Scoring')).toHaveValue('manual');
  await user.click(screen.getByRole('button', { name: 'Save test case' }));
  await screen.findByRole('heading', { name: 'Updated case' });
  expect(ApiClient.updateEvalCase).toHaveBeenLastCalledWith(1, 4, expect.objectContaining({ name: '', criteria: '', method: 'manual' }));
});

it('requires confirmation before removing a case and keeps historical results', async () => {
  const user = userEvent.setup();
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Delete Returns JSON' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete test case?' });
  expect(ApiClient.deleteEvalCase).not.toHaveBeenCalled();
  expect(dialog).toHaveTextContent('Past evaluation results are kept.');
  await user.click(within(dialog).getByRole('button', { name: 'Delete test case' }));
  await screen.findByText('Try your prompt with a few examples.');
  expect(ApiClient.deleteEvalCase).toHaveBeenCalledWith(1, 4);
});

it('keeps case editing available without a provider, while explaining paid actions', async () => {
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: false, provider: null, provider_label: null, model: null,
    available_models: [], budget_exhausted: false, global_budget_remaining_usd: null,
  });
  await open([example]);
  expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Suggest test cases' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add test case' })).toBeEnabled();
  expect(screen.getByRole('link', { name: 'Connect an AI provider' })).toHaveAttribute('href', '/settings#s-api');
});

it('disables billed actions when the shared budget is exhausted', async () => {
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: true, provider: 'custom', provider_label: 'Custom', model: 'example-model',
    available_models: [], budget_exhausted: true, global_budget_remaining_usd: 0,
  });
  await open([example]);
  expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeDisabled();
  expect(screen.getByText(/shared monthly API budget has been reached/i)).toBeInTheDocument();
});

it('runs explicitly, blocks repeated clicks and opens the returned results', async () => {
  const user = userEvent.setup();
  let finish!: (value: EvalRun) => void;
  vi.mocked(ApiClient.runEvaluation).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Run evaluation' }));
  expect(screen.getByRole('button', { name: 'Running evaluation…' })).toBeDisabled();
  expect(screen.getByText(/keep this page open/i)).toBeInTheDocument();
  finish(run);
  await screen.findByText('Clear release notes.');
  expect(screen.getByRole('radio', { name: 'Run history' })).toBeChecked();
  expect(ApiClient.runEvaluation).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('Awaiting your rating')[0]).toBeInTheDocument();
});

it('shows a failed run without making up results or retrying automatically', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.runEvaluation).mockRejectedValue(new ApiError('Your monthly budget has been reached.', 402));
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Run evaluation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your monthly budget has been reached.');
  expect(ApiClient.runEvaluation).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  expect(screen.getByText('No evaluations yet.')).toBeInTheDocument();
});

it('rates a historical manual result and updates its score', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([run]);
  vi.mocked(ApiClient.rateEvalResult).mockResolvedValue({ ...run, score: 80, results: [
    { ...run.results[0], score: 80, is_pending: false, rationale: 'Manually rated 4/5 stars' },
  ] });
  await open();
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  await user.click(screen.getByRole('button', { name: 'Rate 4 out of 5' }));
  await waitFor(() => expect(screen.queryByText('Awaiting your rating')).not.toBeInTheDocument());
  expect(ApiClient.rateEvalResult).toHaveBeenCalledWith(1, 12, 19, 4);
  expect(screen.getAllByText(/80\/100/).length).toBeGreaterThan(0);
});

it('rates an AI-reviewed output beside its AI score and reports agreement', async () => {
  const user = userEvent.setup();
  const judged = { ...run, score: 90, results: [{ ...run.results[0], method: 'judge' as const, score: 90, is_pending: false }] };
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([judged]);
  vi.mocked(ApiClient.rateEvalResult).mockResolvedValue({ ...judged, results: [{ ...judged.results[0], human_score: 40 }] });
  await open();
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  expect(screen.queryByText(/AI review agreed/)).not.toBeInTheDocument();
  const group = screen.getByRole('group', { name: 'Your rating of Review tone' });
  await user.click(within(group).getByRole('button', { name: 'Rate 2 out of 5' }));
  expect(ApiClient.rateEvalResult).toHaveBeenCalledWith(1, 12, 19, 2);
  expect(await screen.findByText('You rated this output 2/5.')).toBeInTheDocument();
  expect(screen.getByText('AI review agreed with your own rating on 0 of 1 output (within one star).')).toBeInTheDocument();
  expect(screen.getAllByText(/90\/100/).length).toBeGreaterThan(0);
});

it('explains why an overall score waits for every manual rating', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([{ ...run, results: [run.results[0], { ...run.results[0], id: 20, label: 'Second review' }] }]);
  vi.mocked(ApiClient.rateEvalResult).mockResolvedValue({ ...run, results: [
    { ...run.results[0], score: 80, is_pending: false }, { ...run.results[0], id: 20, label: 'Second review' },
  ] });
  await open();
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  await user.click(within(screen.getByRole('group', { name: 'Rate Review tone' })).getByRole('button', { name: 'Rate 4 out of 5' }));
  await screen.findByText('1 result needs your rating. The overall score appears after all ratings are saved.');
  expect(screen.getByRole('heading', { name: 'Awaiting your rating' })).toBeInTheDocument();
});

it('reviews AI suggestions without saving them until the user accepts an edited case', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.generateEvalCases).mockResolvedValue({ proposals: [{
    method: 'rule', name: 'Returns JSON', criteria: '{json}', variables: { topic: 'Release notes' },
    rationale: 'Checks the output format.',
  }] });
  await open();
  await user.click(screen.getByRole('button', { name: 'Suggest test cases' }));
  await user.type(screen.getByLabelText('Testing focus (optional)'), 'Output format');
  await user.click(screen.getByRole('button', { name: 'Generate suggestions' }));
  await screen.findByText('Checks the output format.');
  expect(screen.queryByText('Try your prompt with a few examples.')).not.toBeInTheDocument();
  expect(ApiClient.createEvalCase).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Review and add Returns JSON' }));
  expect(screen.getByLabelText('Checks')).toHaveValue('{json}');
  await user.click(screen.getByRole('button', { name: 'Save test case' }));
  await screen.findByRole('heading', { name: 'Returns JSON' });
  expect(ApiClient.createEvalCase).toHaveBeenCalledTimes(1);
  expect(ApiClient.generateEvalCases).toHaveBeenCalledWith(1, 'Output format');
  expect(localStorage.getItem('prompt-maker-studio:eval-suggestions:alex:1')).toBeNull();
});

it('keeps unsaved suggestions across a reload until they are discarded', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.generateEvalCases).mockResolvedValue({ proposals: [{
    method: 'rule', name: 'Returns JSON', criteria: '{json}', variables: { topic: 'Release notes' },
    rationale: 'Checks the output format.',
  }] });
  await open();
  await user.click(screen.getByRole('button', { name: 'Suggest test cases' }));
  await user.click(screen.getByRole('button', { name: 'Generate suggestions' }));
  await screen.findByText('Checks the output format.');
  cleanup();
  await open();
  expect(await screen.findByText('Checks the output format.')).toBeInTheDocument();
  expect(ApiClient.generateEvalCases).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Discard suggestions' }));
  expect(screen.queryByText('Checks the output format.')).not.toBeInTheDocument();
  expect(localStorage.getItem('prompt-maker-studio:eval-suggestions:alex:1')).toBeNull();
});

it('imports CSV as text and appends returned cases', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.importEvalCases).mockResolvedValue([example]);
  await open();
  await user.click(screen.getByRole('button', { name: 'Import CSV' }));
  const file = new File(['method,criteria\nrule,{json}'], 'cases.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => 'method,criteria\nrule,{json}' });
  fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });
  await screen.findByText('cases.csv');
  await user.click(screen.getByRole('button', { name: 'Import test cases' }));
  await screen.findByRole('heading', { name: 'Returns JSON' });
  expect(ApiClient.importEvalCases).toHaveBeenCalledWith(1, 'method,criteria\nrule,{json}');
});

it('exports the existing cases through the browser download helper', async () => {
  const user = userEvent.setup();
  const blob = new Blob(['method,criteria\nrule,{json}']);
  vi.mocked(ApiClient.exportEvalCases).mockResolvedValue(blob);
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Export CSV' }));
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, 'prompt-1-test-cases.csv'));
});

it('retries loading after a network failure', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getEvalCases).mockRejectedValueOnce(new Error('Offline'));
  render(<EvaluationPage promptId={1} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('heading', { name: 'Evaluate' });
});

it('rejects invalid prompt ids before requesting account data', async () => {
  render(<EvaluationPage promptId={NaN} />);
  await screen.findByRole('heading', { name: 'Prompt not found' });
  expect(ApiClient.getPromptById).not.toHaveBeenCalled();
  expect(ApiClient.getEvalCases).not.toHaveBeenCalled();
});

it.each(['constructor', 'toString', '__proto__'])('edits a valid variable called %s without reading inherited object values', async (name) => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue({
    id: 1, name: 'Reserved variable', fields: [{ name: 'Task', content: `Use {{${name}}}` }],
    generated_prompt: `Use {{${name}}}`, created_at: '2026-10-12T10:00:00',
  });
  await open();
  await user.click(screen.getByRole('button', { name: 'Add test case' }));
  expect(screen.getByRole('textbox', { name })).toHaveValue('');
  await user.type(screen.getByRole('textbox', { name }), 'A value');
  await user.selectOptions(screen.getByLabelText('Scoring'), 'manual');
  await user.click(screen.getByRole('button', { name: 'Save test case' }));
  await screen.findByRole('heading', { name: 'Returns JSON' });
  expect(ApiClient.createEvalCase).toHaveBeenCalledWith(1, expect.objectContaining({ variables: { [name]: 'A value' } }));
});

it('keeps missing-input cases from running until intentional placeholders are acknowledged', async () => {
  const user = userEvent.setup();
  await open([{ ...example, variables: {} }]);
  expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Edit Returns JSON' }));
  await user.click(screen.getByRole('checkbox', { name: 'This case intentionally leaves inputs blank' }));
  vi.mocked(ApiClient.updateEvalCase).mockResolvedValue({ ...example, variables: {}, intentionally_empty: true });
  await user.click(screen.getByRole('button', { name: 'Save test case' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeEnabled());
});

it('renders structured judge feedback and keeps a failed case unscored', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([{ ...run, score: 0, results: [
    { ...run.results[0], method: 'judge', score: 0, is_pending: false, rationale: JSON.stringify({
      text: 'The summary missed the release date.', strengths: ['Clear wording'], weaknesses: ['Missing date'],
    }) },
    { ...run.results[0], id: 20, label: 'Provider failure', method: 'rule', is_pending: false, output_text: null, rationale: 'Model run failed: timeout' },
  ] }]);
  await open();
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  expect(screen.getByText('Clear wording')).toBeInTheDocument();
  expect(screen.getByText('Missing date')).toBeInTheDocument();
  expect(screen.getByText('Failed')).toBeInTheDocument();
  expect(screen.getAllByText(/0\/100/).length).toBeGreaterThan(0);
});

it('compares runs by case identity and warns when scoring has changed', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([
    { ...run, score: 80, results: [{ ...run.results[0], is_pending: false, score: 80, criteria: 'Be concise' }] },
    { ...run, id: 11, prompt_version_number: 1, tested_version: 1, score: 60, results: [
      { ...run.results[0], id: 18, is_pending: false, score: 60, criteria: 'Be friendly', output_text: 'Earlier release notes.' },
      { ...run.results[0], id: 17, eval_case_id: 5, label: 'Older test', is_pending: false, score: 60 },
    ] },
  ]);
  await open();
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Compare with' }), '11');
  expect(screen.getByText('Earlier release notes.')).toBeInTheDocument();
  expect(screen.getByText(/inputs or scoring changed/i)).toBeInTheDocument();
  expect(screen.getByText('Not included in this run.')).toBeInTheDocument();
});


it('blocks billed attempts after budget rejection until availability is rechecked', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.runEvaluation).mockRejectedValueOnce(new ApiError('Estimated request exceeds remaining budget.', 402, {
    scope: 'user', resets_at: '2026-11-01T00:00:00+00:00', retry_after: 100,
    reason: 'estimated_cost_exceeds_remaining',
  }));
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Run evaluation' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Suggest test cases' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add test case' })).toBeEnabled();
  expect(screen.getByText(/estimated request cost exceeds your remaining monthly API budget/i)).toBeInTheDocument();
  expect(screen.getByText(/resets/i)).toHaveTextContent('2026');
  expect(screen.getByRole('link', { name: 'Review AI settings' })).toHaveAttribute('href', '/settings#s-api');
  await user.click(screen.getByRole('button', { name: 'Recheck AI availability' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeEnabled());
  expect(ApiClient.runEvaluation).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: 'Returns JSON' })).toBeInTheDocument();
});

it.each([429, 502, 503])('allows an explicit retry after provider failure (%s)', async (status) => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.runEvaluation).mockRejectedValueOnce(new ApiError('Provider unavailable.', status));
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Run evaluation' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Recheck AI availability' })).not.toBeInTheDocument();
});

it('labels caller budget exhaustion correctly and offers rechecking', async () => {
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: true, provider: 'custom', provider_label: 'Custom', model: 'example-model',
    available_models: [], budget_exhausted: true, global_budget_remaining_usd: null,
    user_budget_remaining_usd: 0, budget_scope: 'user', budget_resets_at: '2026-11-01T00:00:00+00:00',
  });
  await open([example]);
  expect(screen.getByText(/your monthly API budget has been reached/i)).toBeInTheDocument();
  expect(screen.queryByText(/shared monthly API budget/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Recheck AI availability' })).toBeEnabled();
});


it('keeps billed actions blocked while a budget recheck is pending or fails', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.runEvaluation).mockRejectedValueOnce(new ApiError('Budget reached.', 402));
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Run evaluation' }));
  await screen.findByRole('alert');
  let reject!: (reason: Error) => void;
  vi.mocked(ApiClient.getPromptsConfig).mockReturnValueOnce(new Promise((_, rejectPromise) => { reject = rejectPromise; }));
  await user.click(screen.getByRole('button', { name: 'Recheck AI availability' }));
  expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeDisabled();
  expect(screen.getByText('Checking AI availability…')).toBeInTheDocument();
  reject(new Error('Offline'));
  await screen.findByRole('button', { name: 'Retry AI availability' });
  expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add test case' })).toBeEnabled();
});

it('builds combined guided checks without requiring rule syntax', async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole('button', { name: 'Add test case' }));
  await user.type(screen.getByLabelText('topic'), 'Release notes');
  await user.type(screen.getByLabelText('Text for check 1'), 'summary');
  await user.click(screen.getByRole('button', { name: 'Add check' }));
  await user.selectOptions(screen.getByLabelText('Check 2'), 'excludes');
  await user.type(screen.getByLabelText('Text for check 2'), 'sorry');
  await user.click(screen.getByRole('button', { name: 'Save test case' }));
  await waitFor(() => expect(ApiClient.createEvalCase).toHaveBeenCalledWith(1, expect.objectContaining({ criteria: 'summary, !sorry' })));
});

it('preserves advanced criteria exactly when an existing case is saved unchanged', async () => {
  const user = userEvent.setup();
  const criteria = '  ~\\d{2,3}, !sorry  ';
  await open([{ ...example, criteria }]);
  await user.click(screen.getByRole('button', { name: 'Edit Returns JSON' }));
  expect(screen.getByLabelText('Checks')).toHaveValue(criteria);
  await user.click(screen.getByRole('button', { name: 'Save test case' }));
  await waitFor(() => expect(ApiClient.updateEvalCase).toHaveBeenCalledWith(1, 4, expect.objectContaining({ criteria })));
});

it('shows failed history and comparison without disclosing legacy provider exceptions', async () => {
  const user = userEvent.setup();
  const failed = { ...run, results: [{ ...run.results[0], is_pending: false, output_text: null, rationale: 'Model run failed: key=secret request={private}' }] };
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([failed, { ...failed, id: 11 }]);
  await open();
  await user.click(screen.getByRole('radio', { name: 'Run history' }));
  expect(screen.getByRole('heading', { name: 'Failed' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings');
  expect(document.body.textContent).not.toContain('key=secret');
  expect(document.body.textContent).not.toContain('request={private}');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Compare with' }), '11');
  expect(screen.getAllByText('Failed').length).toBeGreaterThan(2);
  expect(document.body.textContent).not.toContain('key=secret');
});

it('reports failed case runs honestly in the completion notice', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.runEvaluation).mockResolvedValue({ ...run, results: [{ ...run.results[0], is_pending: false, output_text: null, rationale: 'Model run failed: timeout' }] });
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Run evaluation' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Evaluation: Failed.');
  expect(screen.getByRole('heading', { name: 'Failed' })).toBeInTheDocument();
  expect(ApiClient.runEvaluation).toHaveBeenCalledTimes(1);
});

it('offers AI settings after an explicit run failure without linking case validation to settings', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.runEvaluation).mockRejectedValue(new ApiError('No AI provider is available.', 422));
  await open([example]);
  await user.click(screen.getByRole('button', { name: 'Run evaluation' }));
  expect(await screen.findByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings#s-api');
  await user.click(screen.getByRole('button', { name: 'Edit Returns JSON' }));
  vi.mocked(ApiClient.updateEvalCase).mockRejectedValue(new ApiError('Invalid criteria.', 422));
  await user.click(screen.getByRole('button', { name: 'Save test case' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid criteria.');
  expect(screen.queryByRole('link', { name: 'Open Settings' })).not.toBeInTheDocument();
});
