import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromptEditor from '../PromptEditor';
import { ApiClient, ApiError } from '@/lib/api';
import { storageKey } from '@/lib/branding';
import { pasteHandoffKey } from '@/lib/promptImport';
import { snapshot } from '../editorState';
import type { EvalResult, EvalRun } from '@/types/evaluation';
import type { PromptHistoryResponse, PromptVersionResponse } from '@/types/prompt';

vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  ApiClient: {
    getPromptById: vi.fn(),
    getPromptVersions: vi.fn(),
    getPromptsConfig: vi.fn(),
    getFolders: vi.fn(),
    updatePrompt: vi.fn(),
    createPrompt: vi.fn(),
    restorePromptVersion: vi.fn(),
    parsePromptText: vi.fn(),
    getRefinementQuestions: vi.fn(),
    createRefinementDraft: vi.fn(),
    tryPrompt: vi.fn(),
    getEvalRuns: vi.fn(),
    getEvalCases: vi.fn(),
    runEvaluation: vi.fn(),
  },
}));

// Supplied by `(app)/layout.tsx` in the real app; drafts are namespaced by it.
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ currentUser: 'alex', logout: vi.fn() }),
}));

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
}));

function prompt(overrides: Partial<PromptHistoryResponse> = {}): PromptHistoryResponse {
  return {
    id: 1,
    name: 'Weekly status update',
    fields: [
      { name: 'Role', content: 'You are a concise engineering lead.' },
      { name: 'Context', content: 'Team: {{team}}\nNotes: {{notes}}' },
    ],
    generated_prompt:
      '<ROLE>\nYou are a concise engineering lead.\n</ROLE>\n\n<CONTEXT>\nTeam: {{team}}\nNotes: {{notes}}\n</CONTEXT>',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-08T00:00:00Z',
    folder: 'Work',
    is_favorite: false,
    variable_metadata: { team: { type: 'list', description: 'Team or project name' } },
    ...overrides,
  };
}

function version(overrides: Partial<PromptVersionResponse> = {}): PromptVersionResponse {
  return {
    id: 11,
    version_number: 1,
    note: 'Added the notes variable',
    author: 'alex',
    fields: [{ name: 'Role', content: 'You are an engineering lead.' }],
    generated_prompt: '<ROLE>\nYou are an engineering lead.\n</ROLE>',
    created_at: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

const draftKey = (id: number | 'new') => storageKey(`editor-draft:alex:${id}`);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt());
  vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([]);
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: true,
    provider: 'openai',
    provider_label: 'OpenAI',
    model: 'gpt-4.1-mini',
    available_models: [],
    budget_exhausted: false,
    global_budget_remaining_usd: null,
  });
  vi.mocked(ApiClient.getFolders).mockResolvedValue(['Work', 'Writing']);
  vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([]);
  vi.mocked(ApiClient.getEvalCases).mockResolvedValue([]);
  vi.mocked(ApiClient.getRefinementQuestions).mockResolvedValue({ questions: ['Who will read this?'] });
  vi.mocked(ApiClient.createRefinementDraft).mockResolvedValue({ fields: [
    { name: 'Role', content: 'You are a concise engineering lead writing for managers.' },
    prompt().fields[1],
  ] });
  // jsdom has no native dialog methods; browsers handle modal focus/inertness.
  Object.assign(HTMLDialogElement.prototype, {
    show(this: HTMLDialogElement) { this.setAttribute('open', ''); },
    showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); },
    close(this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
});

/** Opens the saved prompt for template editing; prompts with inputs open ready to fill. */
async function renderSaved() {
  render(<PromptEditor promptId={1} />);
  await screen.findByRole('button', { name: 'Weekly status update' });
  const edit = screen.queryByRole('button', { name: 'Edit template' });
  if (edit) fireEvent.click(edit);
}

it('copies plain text exactly as previewed while keeping placeholders and literal tags', async () => {
  const user = userEvent.setup();
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt({ fields: [{ name: 'Task', content: '  Visit {{team}}. Literal <example>.  ' }] }));
  await renderSaved();
  await user.click(screen.getByText('Output options', { exact: true }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Output format' }), 'plain');
  fireEvent.change(screen.getByLabelText('team', { exact: true }), { target: { value: 'café' } });
  expect(screen.getByLabelText('Prompt text').textContent).toBe('  Visit café. Literal <example>.  ');
  await user.click(screen.getByRole('button', { name: 'Copy filled prompt' }));
  expect(clipboard).toHaveBeenCalledWith('  Visit café. Literal <example>.  ');
});

it('previews a single-section prompt as plain text until section tags are chosen', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt({ fields: [{ name: 'Task', content: 'Visit {{team}}.' }] }));
  await renderSaved();
  expect(screen.getByLabelText('Prompt text').textContent).toBe('Visit {{team}}.');
  await user.click(screen.getByText('Output options', { exact: true }));
  expect(screen.getByRole('combobox', { name: 'Output format' })).toHaveValue('plain');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Output format' }), 'sections');
  expect(screen.getByLabelText('Prompt text').textContent).toBe('<TASK>\nVisit {{team}}.\n</TASK>');
});

it('dismisses advisory markup warnings without editing the prompt', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt({ fields: [{ name: 'Task', content: 'Keep literal <example>.' }] }));
  await renderSaved();
  await user.click(screen.getByRole('button', { name: 'Dismiss markup warning for Task' }));
  expect(screen.queryByText(/Possible unmatched tag/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Task text')).toHaveValue('Keep literal <example>.');
  expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
});

it('opens full prompt details without beginning a rename', async () => {
  const user = userEvent.setup();
  await renderSaved();
  await user.click(screen.getByRole('button', { name: 'Tools' }));
  await user.click(screen.getByRole('button', { name: 'Prompt details' }));
  const details = screen.getByRole('dialog', { name: 'Prompt details' });
  expect(details).toHaveTextContent('Weekly status update');
  expect(details).toHaveTextContent('Work');
  expect(screen.queryByRole('textbox', { name: 'Prompt name' })).not.toBeInTheDocument();
});

it('closes secondary tools on Escape, outside input and opening history', async () => {
  const user = userEvent.setup();
  await renderSaved();
  const tools = screen.getByRole('button', { name: 'Tools' });
  expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();
  await user.click(tools);
  expect(screen.getByRole('link', { name: 'Evaluate' })).toHaveAttribute('href', '/editor/1/evaluate');
  await user.keyboard('{Escape}');
  expect(tools).toHaveFocus();
  expect(tools).toHaveAttribute('aria-expanded', 'false');
  await user.click(tools);
  await user.click(screen.getByLabelText('Role text'));
  expect(tools).toHaveAttribute('aria-expanded', 'false');
  await user.click(tools);
  await openTool(user, 'History');
  expect(screen.getByRole('complementary', { name: 'Version history' })).toBeInTheDocument();
  expect(tools).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Close history' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Close history' }));
  expect(tools).toHaveFocus();
  await openTool(user, 'History');
  await openTool(user, 'History');
  expect(screen.queryByRole('complementary', { name: 'Version history' })).not.toBeInTheDocument();
  expect(tools).toHaveFocus();
});

it('keeps AI testing open with its output across a Template and Filled switch', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.tryPrompt).mockResolvedValueOnce({ output_text: 'One output', provider: 'openai', model: 'gpt-4.1-mini' });
  await renderSaved();
  await user.type(screen.getByPlaceholderText('Team or project name'), 'Platform');
  await user.click(screen.getByText('Test with AI'));
  await user.click(screen.getByRole('button', { name: 'Try once' }));
  await screen.findByRole('region', { name: 'Try once output' });
  await user.click(screen.getByRole('radio', { name: 'Template' }));
  await user.click(screen.getByRole('radio', { name: 'Filled' }));
  expect(screen.getByRole('region', { name: 'Try once output' })).toBeVisible();
});

it('copies the Try once output on its own', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.tryPrompt).mockResolvedValueOnce({ output_text: 'One output', provider: 'openai', model: 'gpt-4.1-mini' });
  await renderSaved();
  await user.type(screen.getByPlaceholderText('Team or project name'), 'Platform');
  await user.click(screen.getByText('Test with AI'));
  await user.click(screen.getByRole('button', { name: 'Try once' }));
  const output = await screen.findByRole('region', { name: 'Try once output' });
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await user.click(within(output).getByRole('button', { name: 'Copy output' }));
  expect(clipboard).toHaveBeenCalledWith('One output');
  expect(within(output).getByRole('button', { name: 'Copied' })).toBeVisible();
});

it('returns focus to Tools after dismissing the saved-prompt importer', async () => {
  const user = userEvent.setup();
  await renderSaved();
  await openTool(user, 'Paste a prompt');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Paste a prompt' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tools' })).toHaveFocus();
});

it('opens AI testing explicitly without running or saving the prompt', async () => {
  const user = userEvent.setup();
  await renderSaved();
  expect(screen.getByRole('button', { name: 'Try once' })).not.toBeVisible();
  await user.click(screen.getByText('Test with AI'));
  expect(screen.getByRole('button', { name: 'Try once' })).toBeEnabled();
  expect(within(screen.getByRole('complementary', { name: 'Preview' })).getByText(/Your provider may charge for these calls/)).toBeVisible();
  expect(ApiClient.tryPrompt).not.toHaveBeenCalled();
  expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
});

async function openTool(user: ReturnType<typeof userEvent.setup>, name: string) {
  if (!screen.queryByRole('button', { name })) await user.click(screen.getByRole('button', { name: 'Tools' }));
  await user.click(screen.getByRole('button', { name }));
}

it('keeps a successful save when refreshing version history fails', async () => {
  const user = userEvent.setup();
  await renderSaved();
  fireEvent.change(screen.getByLabelText('Role text'), { target: { value: 'Updated role' } });
  vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt({ fields: [{ name: 'Role', content: 'Updated role' }, prompt().fields[1]] }));
  vi.mocked(ApiClient.getPromptVersions).mockRejectedValueOnce(new Error('History unavailable'));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved. Version history is unavailable; reload to retry.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  expect(screen.getByLabelText('Role text')).toHaveValue('Updated role');
});

it.each(['x', '😀'])('shows inline section length validation and prevents saving without truncating %s content', async (character) => {
  const user = userEvent.setup();
  await renderSaved();
  const text = screen.getByLabelText('Role text');
  fireEvent.change(text, { target: { value: character.repeat(10001) } });
  expect(text).toHaveValue(character.repeat(10001));
  expect(text).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Section text must be 10,000 characters or fewer.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
  fireEvent.change(text, { target: { value: character.repeat(10000) } });
  expect(text).toHaveAttribute('aria-invalid', 'false');
});

describe('known-good version and test results in History', () => {
  it('shows each version\'s newest test result and marks a version as known good', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([version()]);
    vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([
      evalRun({ id: 9, score: 90, tested_prompt: prompt().generated_prompt }),
      evalRun({ id: 8, score: 40, tested_prompt: prompt().generated_prompt }),
    ]);
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt({ known_good_version: 2 }));
    await renderSaved();
    await openTool(user, 'History');
    const history = screen.getByRole('complementary', { name: 'Version history' });
    expect(await within(history).findByText('Tested · 90/100')).toBeInTheDocument();
    expect(within(history).getByText('Not tested')).toBeInTheDocument();
    await user.click(within(history).getByRole('button', { name: 'Mark as known good' }));
    expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, expect.objectContaining({ known_good_version: 2 }));
    expect(await within(history).findByText('Version 2, current · known good')).toBeInTheDocument();
    expect(within(history).getByRole('button', { name: 'Remove known-good mark' })).toBeInTheDocument();
  });

  it('shows no test results when the prompt was never evaluated', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([version()]);
    await renderSaved();
    await openTool(user, 'History');
    await waitFor(() => expect(ApiClient.getEvalRuns).toHaveBeenCalledWith(1, 100));
    expect(screen.queryByText('Not tested')).not.toBeInTheDocument();
  });
});

describe('variable inputs and reversible import', () => {
  it('allows restoring variable settings when the prompt text is unchanged', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([version({
      fields: prompt().fields, generated_prompt: prompt().generated_prompt, variable_metadata: {},
    })]);
    vi.mocked(ApiClient.restorePromptVersion).mockResolvedValue(prompt({ variable_metadata: {} }));
    await renderSaved();
    await openTool(user, 'History');
    await user.click(screen.getByRole('button', { name: /Version 1/ }));
    expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Restore version 1' }));
    await waitFor(() => expect(ApiClient.restorePromptVersion).toHaveBeenCalledWith(1, 11));
    expect(screen.getByLabelText('Hint for team')).toHaveValue('');
  });
  it('clears a hint without losing required inputs or examples', async () => {
    const user = userEvent.setup();
    render(<PromptEditor />);
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'Explain {{topic}}.' } });
    await user.click(screen.getByLabelText('Required topic'));
    await user.type(screen.getByLabelText('Example input for topic'), 'Space');
    await user.type(screen.getByLabelText('Hint for topic'), 'Subject');
    await user.clear(screen.getByLabelText('Hint for topic'));
    expect(screen.getByLabelText('Required topic')).toBeChecked();
    expect(screen.getByLabelText('Example input for topic')).toHaveValue('Space');
  });
  it('requires explicit copying with placeholders for missing required inputs and loads examples on demand', async () => {
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt({ variable_metadata: {
      team: { type: 'text', required: true, example: 'Platform' },
    } }));
    await renderSaved();
    expect(screen.getByRole('button', { name: 'Copy filled prompt' })).toBeDisabled();
    expect(screen.getByLabelText('team Required')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText('team Required'), '   ');
    expect(screen.getByLabelText('Prompt text')).toHaveTextContent('{{team}}');
    await user.click(screen.getByRole('button', { name: 'Copy with placeholders' }));
    expect(clipboard).toHaveBeenCalledWith(prompt().generated_prompt);
    expect(screen.getByLabelText('team Required')).toHaveValue('   ');
    await user.click(screen.getByRole('button', { name: 'Load example inputs' }));
    expect(screen.getByLabelText('team Required')).toHaveValue('Platform');
    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Copy filled prompt' }));
    expect(clipboard).toHaveBeenLastCalledWith(prompt().generated_prompt.replace('{{team}}', 'Platform'));
  });

  it('imports into a draft and restores previous sections and variable settings with Undo', async () => {
    const user = userEvent.setup();
    render(<PromptEditor />);
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'Explain {{topic}}.' } });
    await user.type(screen.getByLabelText('Example input for topic'), 'Space');
    vi.mocked(ApiClient.parsePromptText).mockResolvedValue({ fields: [{ name: 'Imported', content: 'New text' }] });
    await openTool(user, 'Paste a prompt');
    expect(screen.getByText(/current draft stays as it is/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Paste a prompt' })).getByText(/Uses your connection \(OpenAI \/ gpt-4.1-mini\)/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Prompt to convert'), 'New text');
    await user.click(screen.getByRole('button', { name: 'Create template' }));
    await user.click(await screen.findByRole('button', { name: 'Use in editor' }));
    expect(await screen.findByLabelText('Imported text')).toHaveValue('New text');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Task text')).toHaveValue('Explain {{topic}}.');
    expect(screen.getByLabelText('Example input for topic')).toHaveValue('Space');
    expect(ApiClient.createPrompt).not.toHaveBeenCalled();
  });
});

it('only opens evaluation for a saved prompt without unsaved changes', async () => {
  const user = userEvent.setup();
  await renderSaved();
  await user.click(screen.getByRole('button', { name: 'Tools' }));
  expect(screen.getByRole('link', { name: 'Evaluate' })).toHaveAttribute('href', '/editor/1/evaluate');
  await user.type(screen.getByLabelText('Role text'), ' Updated.');
  await user.click(screen.getByRole('button', { name: 'Tools' }));
  expect(screen.queryByRole('link', { name: 'Evaluate' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Evaluate' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Evaluate' })).toHaveAttribute('title', 'Save your changes before evaluating.');
});

function evalResult(overrides: Partial<EvalResult>): EvalResult {
  return {
    id: 1, eval_case_id: 1, method: 'rule', label: 'Case', rationale: null, score: 50, human_score: null,
    is_pending: false, output_text: 'An output.', criteria: null, variables: {}, judge_model: null, ...overrides,
  };
}

function evalRun(overrides: Partial<EvalRun>): EvalRun {
  return {
    id: 7, prompt_id: 1, prompt_version_number: 1, tested_version: 1, matches_current: true, tested_prompt: null,
    score: 50, created_at: '2026-10-20T10:00:00', model: 'gpt-4.1-mini', total_latency_ms: 1,
    total_prompt_tokens: 1, total_completion_tokens: 1, total_cost_usd: 0, results: [], ...overrides,
  };
}

describe('refinement with test results', () => {
  const latest = evalRun({ results: [
    evalResult({ id: 31, label: 'Long notes', score: 80 }),
    evalResult({ id: 32, label: 'Empty notes', score: 20 }),
    evalResult({ id: 33, label: 'Provider failure', score: null, output_text: null }),
  ] });

  it('offers the latest scored results, weakest first, and sends only the chosen ones', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([latest]);
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    const picker = await screen.findByRole('group', { name: 'Improve using test results (optional)' });
    expect(within(picker).getAllByRole('checkbox').map((box) => box.closest('label')?.textContent))
      .toEqual(['Empty notes · 20/100', 'Long notes · 80/100']);
    await user.click(within(picker).getByRole('checkbox', { name: 'Empty notes · 20/100' }));
    await user.click(screen.getByRole('button', { name: 'Improve without questions' }));
    await screen.findByRole('button', { name: 'Apply changes' });
    expect(ApiClient.createRefinementDraft).toHaveBeenCalledWith(prompt().fields, [], { prompt_id: 1, run_id: 7, result_ids: [32] });
  });

  it('skips a newer check of another unsaved draft for the run of the text being refined', async () => {
    const user = userEvent.setup();
    const otherDraft = evalRun({ id: 9, tested_version: null, tested_prompt: 'Discarded draft', results: [evalResult({ id: 41, label: 'Draft case', score: 100 })] });
    vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([otherDraft, latest]);
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    const picker = await screen.findByRole('group', { name: 'Improve using test results (optional)' });
    expect(within(picker).queryByText('Draft case · 100/100')).not.toBeInTheDocument();
    await user.click(within(picker).getByRole('checkbox', { name: 'Empty notes · 20/100' }));
    await user.click(screen.getByRole('button', { name: 'Improve without questions' }));
    await screen.findByRole('button', { name: 'Apply changes' });
    expect(ApiClient.createRefinementDraft).toHaveBeenCalledWith(prompt().fields, [], { prompt_id: 1, run_id: 7, result_ids: [32] });
  });

  it('finds the saved-version run behind many checks of other drafts', async () => {
    const user = userEvent.setup();
    const drafts = Array.from({ length: 25 }, (_, i) => evalRun({ id: 100 + i, tested_version: null, tested_prompt: `Draft ${i}`, results: [evalResult({ id: 200 + i, label: 'Draft case', score: 100 })] }));
    vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([...drafts, latest]);
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    const picker = await screen.findByRole('group', { name: 'Improve using test results (optional)' });
    expect(within(picker).getByRole('checkbox', { name: 'Empty notes · 20/100' })).toBeInTheDocument();
    expect(ApiClient.getEvalRuns).toHaveBeenCalledWith(1, 100);
  });

  it('checks a draft against the test cases, reusing a run of the current text', async () => {
    const user = userEvent.setup();
    const current = evalRun({ id: 8, tested_prompt: prompt().generated_prompt, results: [evalResult({ output_text: 'Before.' })] });
    vi.mocked(ApiClient.getEvalRuns).mockResolvedValue([current]);
    vi.mocked(ApiClient.getEvalCases).mockResolvedValue([{ id: 1 }] as never);
    vi.mocked(ApiClient.runEvaluation).mockResolvedValue(evalRun({ id: 9, tested_version: null, results: [evalResult({ output_text: 'After.', score: 90 })] }));
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Improve without questions' }));
    expect(await screen.findByText(/Runs your 1 test case on this draft with your AI connection/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check against test cases' }));
    expect(await screen.findByText('After.')).toBeInTheDocument();
    expect(screen.getByText('Before.')).toBeInTheDocument();
    expect(ApiClient.runEvaluation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ApiClient.runEvaluation).mock.calls[0][1]?.[0].content).toBe('You are a concise engineering lead writing for managers.');
    expect(screen.getAllByRole('heading', { name: 'This draft' }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Each case ran once/)).toBeInTheDocument();
    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
  });

  it('runs the current prompt too when no run tested its text', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getEvalCases).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    vi.mocked(ApiClient.runEvaluation).mockResolvedValue(evalRun({ tested_version: null }));
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Improve without questions' }));
    expect(await screen.findByText(/Runs your 2 test cases on this draft and on your current prompt/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check against test cases' }));
    await screen.findByText(/Each case ran once/);
    expect(vi.mocked(ApiClient.runEvaluation).mock.calls.map((call) => call[1]?.[0].content)).toEqual([
      'You are a concise engineering lead writing for managers.', prompt().fields[0].content,
    ]);
  });
});

describe('prompt refinement', () => {
  it('keeps a pending request when closed and restores focus without starting another call', async () => {
    const user = userEvent.setup();
    let finish!: (value: { questions: string[] }) => void;
    vi.mocked(ApiClient.getRefinementQuestions).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await renderSaved();
    const trigger = screen.getByRole('button', { name: 'Refine' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await screen.findByText('Finding questions…');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Refine prompt' }), { key: 'Escape' });
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByRole('button', { name: 'Find questions' })).toBeDisabled();
    finish({ questions: ['Audience?'] });
    await screen.findByLabelText('Audience?');
    expect(ApiClient.getRefinementQuestions).toHaveBeenCalledTimes(1);
  });

  it('retries finding questions explicitly after failure', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getRefinementQuestions).mockRejectedValueOnce(new Error('Provider unavailable'));
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider unavailable');
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await screen.findByLabelText('Who will read this?');
    expect(ApiClient.getRefinementQuestions).toHaveBeenCalledTimes(2);
  });

  it('creates a draft with every question left blank', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getRefinementQuestions).mockResolvedValueOnce({ questions: ['Audience?', 'Tone?'] });
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await screen.findByLabelText('Audience?');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await screen.findByRole('button', { name: 'Apply changes' });
    expect(ApiClient.createRefinementDraft).toHaveBeenCalledWith(prompt().fields, [], undefined);
  });

  it('allows skipping individual questions and returning from review', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getRefinementQuestions).mockResolvedValueOnce({ questions: ['Audience?', 'Tone?'] });
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await screen.findByLabelText('Audience?');
    await user.type(screen.getByLabelText('Audience?'), 'Managers');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await screen.findByRole('button', { name: 'Apply changes' });
    expect(ApiClient.createRefinementDraft).toHaveBeenCalledWith(prompt().fields, [{ question: 'Audience?', answer: 'Managers' }], undefined);
    await user.click(screen.getByRole('radio', { name: 'Full draft' }));
    expect(screen.getByLabelText('Draft Context')).toHaveTextContent('{{team}}');
    await user.click(screen.getByRole('button', { name: 'Back to answers' }));
    expect(screen.getByLabelText('Audience?')).toHaveValue('Managers');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await user.click(await screen.findByRole('button', { name: 'Discard draft' }));
    expect(screen.getByLabelText('Role text')).toHaveValue(prompt().fields[0].content);
    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
  });

  it('does not allow applying an unchanged draft', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.createRefinementDraft).mockResolvedValueOnce({ fields: prompt().fields });
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await user.type(await screen.findByLabelText('Who will read this?'), 'Managers');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await screen.findByText('The draft is identical to your prompt.');
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    await user.click(screen.getByText('Context', { selector: 'summary' }));
    expect(screen.getByText('Context', { selector: 'summary' }).closest('details')).toHaveTextContent('Team: {{team}}');
  });

  it('never overwrites subsequent edits with Undo', async () => {
    const user = userEvent.setup();
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await user.type(await screen.findByLabelText('Who will read this?'), 'Managers');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await user.click(await screen.findByRole('button', { name: 'Apply changes' }));
    await user.type(screen.getByLabelText('Role text'), ' New edit.');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead writing for managers. New edit.');
    expect(screen.getByRole('status')).toHaveTextContent('Undo is no longer available');
  });

  it('refines current edits, reviews changes, applies locally, undoes and saves normally', async () => {
    const user = userEvent.setup();
    await renderSaved();
    await user.type(screen.getByPlaceholderText('Team or project name'), 'Platform team');
    await user.type(screen.getByLabelText('Role text'), ' Be brief.');
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    expect(ApiClient.getRefinementQuestions).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Role text')).toBeDisabled();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    expect(ApiClient.getRefinementQuestions).toHaveBeenCalledWith([
      { name: 'Role', content: 'You are a concise engineering lead. Be brief.' }, prompt().fields[1],
    ], false);
    await user.type(await screen.findByLabelText('Who will read this?'), 'Managers');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await screen.findByRole('button', { name: 'Apply changes' });
    expect(screen.getByLabelText('Changes to Role').querySelector('ins')).toBeInTheDocument();
    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead writing for managers.');
    expect(screen.getByLabelText('Hint for team')).toHaveValue('Team or project name');
    expect(screen.getByPlaceholderText('Team or project name')).toHaveValue('Platform team');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead. Be brief.');
    expect(screen.getByPlaceholderText('Team or project name')).toHaveValue('Platform team');
    vi.mocked(ApiClient.updatePrompt).mockImplementation(async (_id, body) => prompt({ fields: body.fields! }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalled());
    expect(vi.mocked(ApiClient.updatePrompt).mock.calls[0][1].variable_metadata?.team.type).toBe('list');
  });

  it('works with a new unsaved prompt and keeps answers when closed or a draft fails', async () => {
    const user = userEvent.setup();
    render(<PromptEditor />);
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'Explain {{topic}}' } });
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await user.type(await screen.findByLabelText('Who will read this?'), 'Beginners');
    await user.click(screen.getByRole('button', { name: 'Close refinement' }));
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    expect(screen.getByLabelText('Who will read this?')).toHaveValue('Beginners');
    expect(ApiClient.getRefinementQuestions).toHaveBeenCalledTimes(1);
    vi.mocked(ApiClient.createRefinementDraft).mockRejectedValueOnce(new Error('Budget exhausted'));
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Who will read this?')).toHaveValue('Beginners');
    expect(ApiClient.createPrompt).not.toHaveBeenCalled();
    expect(ApiClient.createRefinementDraft).toHaveBeenCalledWith(
      [{ name: 'Task', content: 'Explain {{topic}}' }],
      [{ question: 'Who will read this?', answer: 'Beginners' }],
      undefined,
    );
    expect(ApiClient.getEvalRuns).not.toHaveBeenCalled();
  });

  it('invalidates a closed session when the source changes', async () => {
    const user = userEvent.setup();
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await screen.findByLabelText('Who will read this?');
    await user.click(screen.getByRole('button', { name: 'Close refinement' }));
    await user.type(screen.getByLabelText('Role text'), ' Changed.');
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    expect(screen.getByText(/Your prompt changed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.getByRole('button', { name: 'Find questions' })).toBeInTheDocument();
    expect(ApiClient.getRefinementQuestions).toHaveBeenCalledTimes(1);
  });

  it('offers optional questions when none are found', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getRefinementQuestions).mockResolvedValueOnce({ questions: [] });
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await screen.findByText('No important gaps were identified.');
    await user.click(screen.getByRole('button', { name: 'Ask more questions' }));
    await screen.findByLabelText('Who will read this?');
    expect(ApiClient.getRefinementQuestions).toHaveBeenLastCalledWith(prompt().fields, true);
  });

  it('improves the prompt without questions, from the start or when no gaps are found', async () => {
    const user = userEvent.setup();
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Improve without questions' }));
    await screen.findByRole('button', { name: 'Apply changes' });
    expect(ApiClient.createRefinementDraft).toHaveBeenLastCalledWith(prompt().fields, [], undefined);
    expect(ApiClient.getRefinementQuestions).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    vi.mocked(ApiClient.getRefinementQuestions).mockResolvedValueOnce({ questions: [] });
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await screen.findByText('No important gaps were identified.');
    await user.click(screen.getByRole('button', { name: 'Improve without questions' }));
    await screen.findByRole('button', { name: 'Apply changes' });
    expect(ApiClient.createRefinementDraft).toHaveBeenCalledTimes(2);
  });

  it('keeps an applied draft so it can be applied again after Undo without another AI call', async () => {
    const user = userEvent.setup();
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Find questions' }));
    await user.type(await screen.findByLabelText('Who will read this?'), 'Managers');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await user.click(await screen.findByRole('button', { name: 'Apply changes' }));
    const refined = 'You are a concise engineering lead writing for managers.';
    expect(screen.getByLabelText('Role text')).toHaveValue(refined);
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    expect(screen.getByText('These changes are applied to your draft.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close refinement' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Role text')).toHaveValue(prompt().fields[0].content);
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect(screen.getByLabelText('Role text')).toHaveValue(refined);
    expect(ApiClient.createRefinementDraft).toHaveBeenCalledTimes(1);
  });

  it('explains a missing connection without starting an AI call', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({ provider_connected: false } as never);
    await renderSaved();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    expect(screen.getByText('Refinement needs an AI connection.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings#s-api');
    expect(ApiClient.getRefinementQuestions).not.toHaveBeenCalled();
  });
});

describe('PromptEditor with a saved prompt', () => {
  it('shows its sections and opens the preview filled in when it has variables', async () => {
    await renderSaved();

    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead.');
    expect(screen.getByRole('radio', { name: 'Filled' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Prompt text')).toHaveTextContent('<CONTEXT>');
    expect(screen.getByPlaceholderText('Team or project name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  });

  it('saves edited sections with Ctrl+S, sending sections but never the text', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockImplementation(async (_id, body) =>
      prompt({ fields: body.fields!, updated_at: '2026-07-09T00:00:00Z' }),
    );
    await renderSaved();

    await user.type(screen.getByLabelText('Role text'), ' Be brief.');
    expect(screen.getByText('Edited')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Version note'), 'Shorter role');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalledTimes(1));
    const body = vi.mocked(ApiClient.updatePrompt).mock.calls[0][1];
    expect(body).toEqual({
      fields: [
        { name: 'Role', content: 'You are a concise engineering lead. Be brief.' },
        { name: 'Context', content: 'Team: {{team}}\nNotes: {{notes}}' },
      ],
      variable_metadata: { team: { type: 'list', description: 'Team or project name' } },
      note: 'Shorter role',
      last_updated_at: '2026-07-08T00:00:00Z',
    });
    expect(body).not.toHaveProperty('generated_prompt');
    expect(await screen.findByText('Saved', { selector: '[role="status"]' })).toBeInTheDocument();
    expect(ApiClient.getPromptVersions).toHaveBeenCalledTimes(2);
  });

  it('does nothing on Ctrl+S when nothing changed', async () => {
    await renderSaved();

    fireEvent.keyDown(window, { key: 's', metaKey: true });

    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
  });

  it('blocks saving while two sections render to the same tag', async () => {
    const user = userEvent.setup();
    await renderSaved();

    await user.click(screen.getByRole('button', { name: 'Add section' }));
    const names = screen.getAllByLabelText('Section name');
    await user.clear(names[2]);
    await user.type(names[2], 'role');

    // Both clashing sections say so.
    expect(screen.getAllByText(/Another section already becomes <ROLE>/)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
    expect(screen.getByText('Fix the highlighted section names before saving.')).toBeInTheDocument();
  });

  it('keeps a hint’s stored type when the hint is edited', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    await renderSaved();

    await user.type(screen.getByLabelText('Hint for notes'), 'Paste standup notes');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalled());
    expect(vi.mocked(ApiClient.updatePrompt).mock.calls[0][1].variable_metadata).toEqual({
      team: { type: 'list', description: 'Team or project name' },
      notes: { type: 'text', description: 'Paste standup notes' },
    });
  });

  it('restores a draft made against the same saved state, and can discard it', async () => {
    const user = userEvent.setup();
    const saved = prompt();
    localStorage.setItem(
      draftKey(1),
      JSON.stringify({
        base: JSON.stringify({
          fields: saved.fields,
          metadata: [['team', saved.variable_metadata!.team]],
        }),
        sections: [{ name: 'Role', content: 'Draft role' }],
        metadata: saved.variable_metadata,
      }),
    );

    await renderSaved();

    expect(screen.getByText('Your unsaved changes were restored.')).toBeInTheDocument();
    expect(screen.getByLabelText('Role text')).toHaveValue('Draft role');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead.');
    expect(localStorage.getItem(draftKey(1))).toBeNull();
  });

  it('ignores a draft made against an older saved state', async () => {
    localStorage.setItem(
      draftKey(1),
      JSON.stringify({ base: 'something older', sections: [{ name: 'Role', content: 'x' }], metadata: {} }),
    );

    await renderSaved();

    expect(screen.queryByText('Your unsaved changes were restored.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead.');
  });

  it('copies the filled prompt, flagging variables left as placeholders', async () => {
    const user = userEvent.setup();
    await renderSaved();

    await user.type(screen.getByPlaceholderText('Team or project name'), 'Payments');
    expect(screen.getByText(/is not filled in/)).toHaveTextContent('notes is not filled in. It’ll be copied as a placeholder.');
    // Optional gaps already copy as placeholders, so no second copy button.
    expect(screen.queryByRole('button', { name: 'Copy with placeholders' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy filled prompt' }));

    expect(await navigator.clipboard.readText()).toBe(
      '<ROLE>\nYou are a concise engineering lead.\n</ROLE>\n\n<CONTEXT>\nTeam: Payments\nNotes: {{notes}}\n</CONTEXT>',
    );
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('copies the template without any unfilled-variable warning', async () => {
    const user = userEvent.setup();
    await renderSaved();

    await user.click(screen.getByRole('radio', { name: 'Template' }));
    expect(screen.queryByText(/not filled in/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy template' }));

    expect(await navigator.clipboard.readText()).toBe(prompt().generated_prompt);
  });

  it('keeps edits through a conflict and loads the other session’s version on request', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockRejectedValue(new ApiError('modified elsewhere', 409));
    await renderSaved();

    await user.type(screen.getByLabelText('Role text'), ' Mine.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/changed somewhere else/)).toBeInTheDocument();
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(
      prompt({ updated_at: '2026-07-10T00:00:00Z' }),
    );
    await user.click(screen.getByRole('button', { name: 'Load latest version' }));

    await waitFor(() => expect(screen.queryByText(/changed somewhere else/)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead. Mine.');
  });

  it('compares a version with the current text and restores it', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([version()]);
    vi.mocked(ApiClient.restorePromptVersion).mockResolvedValue(
      prompt({ fields: version().fields, generated_prompt: version().generated_prompt }),
    );
    await renderSaved();

    await openTool(user, 'History');
    const history = screen.getByRole('complementary', { name: 'Version history' });
    expect(within(history).getByText('Version 2, current')).toBeInTheDocument();
    await user.click(within(history).getByRole('button', { name: /Version 1/ }));
    expect(within(history).getByLabelText('Changes since this version')).toHaveTextContent('concise');
    await user.click(within(history).getByRole('button', { name: 'Restore version 1' }));

    await waitFor(() => expect(ApiClient.restorePromptVersion).toHaveBeenCalledWith(1, 11));
    expect(screen.getByLabelText('Role text')).toHaveValue('You are an engineering lead.');
    expect(screen.getByText('Restored version 1')).toBeInTheDocument();
  });

  it('dates each version by when it was written, not when it was replaced', async () => {
    const user = userEvent.setup();
    const shown = (iso: string) => new Date(iso).toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
    vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([
      version({ id: 12, version_number: 2, created_at: '2026-07-05T00:00:00Z' }),
      version({ id: 11, version_number: 1, created_at: '2026-07-03T00:00:00Z' }),
    ]);
    await renderSaved();
    await openTool(user, 'History');
    const history = screen.getByRole('complementary', { name: 'Version history' });
    expect(within(history).getByText('Version 3, current').parentElement).toHaveTextContent(shown('2026-07-05T00:00:00Z'));
    expect(within(history).getByRole('button', { name: /Version 2/ })).toHaveTextContent(shown('2026-07-03T00:00:00Z'));
    expect(within(history).getByRole('button', { name: /Version 1/ })).toHaveTextContent(shown('2026-07-01T00:00:00Z'));
  });

  it('does not restore over unsaved edits', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([version()]);
    await renderSaved();

    await user.type(screen.getByLabelText('Role text'), ' Edited.');
    await openTool(user, 'History');
    await user.click(screen.getByRole('button', { name: /Version 1/ }));

    expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeDisabled();
    expect(screen.getByText('Save or discard your edits before restoring.')).toBeInTheDocument();
  });

  it('removes a section with an undo', async () => {
    const user = userEvent.setup();
    await renderSaved();

    await user.click(screen.getByRole('button', { name: 'Remove Context' }));
    expect(screen.queryByLabelText('Context text')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Context text')).toBeInTheDocument();
  });

  it('warns about uneven tags and, once left, empty sections', async () => {
    const user = userEvent.setup();
    await renderSaved();

    const role = screen.getByLabelText('Role text');
    await user.clear(role);
    await user.type(role, 'Use <b>bold');
    expect(screen.getByText(/Possible unmatched tag: <b>/)).toBeInTheDocument();

    await user.clear(role);
    expect(screen.getByText(/This section is empty/)).toBeInTheDocument();
  });

  it('renames and moves the prompt without touching its content', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockImplementation(async (_id, body) =>
      prompt({ ...body, updated_at: '2026-07-09T00:00:00Z' } as Partial<PromptHistoryResponse>),
    );
    await renderSaved();

    await user.click(screen.getByRole('button', { name: 'Weekly status update' }));
    const name = screen.getByLabelText('Prompt name');
    await user.clear(name);
    await user.type(name, 'Status update{Enter}');
    await waitFor(() =>
      expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, {
        name: 'Status update',
        last_updated_at: '2026-07-08T00:00:00Z',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Work' }));
    const folder = screen.getByRole('dialog', { name: 'Move to folder' });
    await user.clear(within(folder).getByRole('combobox'));
    await user.type(within(folder).getByRole('combobox'), 'Writing');
    await user.click(within(folder).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(ApiClient.updatePrompt).toHaveBeenLastCalledWith(1, {
        folder: 'Writing',
        last_updated_at: '2026-07-09T00:00:00Z',
      }),
    );
  });
});

describe('PromptEditor with a new prompt', () => {
  it('keeps Paste a prompt inline and offers no saved-prompt tools', async () => {
    render(<PromptEditor />);
    expect(await screen.findByRole('button', { name: 'Paste a prompt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument();
  });

  it('returns focus to Paste a prompt after dismissing the importer, however it opened', async () => {
    const user = userEvent.setup();
    const view = render(<PromptEditor />);
    await user.click(await screen.findByRole('button', { name: 'Paste a prompt' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Paste a prompt' })).toHaveFocus();
    view.unmount();

    render(<PromptEditor openImport />);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste a prompt' })).toHaveFocus();
  });

  it('closes Starter templates on Escape and returns focus to its button', async () => {
    const user = userEvent.setup();
    render(<PromptEditor />);
    const starter = await screen.findByRole('button', { name: 'Starter templates' });
    await user.click(starter);
    await user.keyboard('{Escape}');
    expect(starter).toHaveAttribute('aria-expanded', 'false');
    await user.click(starter);
    await user.tab();
    await user.keyboard('{Escape}');
    expect(starter).toHaveAttribute('aria-expanded', 'false');
    expect(starter).toHaveFocus();
  });

  it('asks for a name, creates the prompt, and moves to its page', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.createPrompt).mockResolvedValue(prompt({ id: 42 }));
    render(<PromptEditor />);

    await user.type(screen.getByLabelText('Task text'), 'Summarise {{{{text}}');
    expect(localStorage.getItem(draftKey('new'))).not.toBeNull();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    const dialog = await screen.findByRole('dialog', { name: 'Save prompt' });
    await user.type(within(dialog).getByPlaceholderText(/Weekly status update/), 'Summariser');
    await user.type(within(dialog).getByRole('combobox'), 'Writing');
    await user.click(within(dialog).getByRole('button', { name: 'Save prompt' }));

    await waitFor(() =>
      expect(ApiClient.createPrompt).toHaveBeenCalledWith({
        name: 'Summariser',
        fields: [{ name: 'Task', content: 'Summarise {{text}}' }],
        folder: 'Writing',
        variable_metadata: {},
      }),
    );
    expect(routerReplace).toHaveBeenCalledWith('/editor/42');
    expect(localStorage.getItem(draftKey('new'))).toBeNull();
  });

  it('requires a name before creating', async () => {
    const user = userEvent.setup();
    render(<PromptEditor />);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save prompt' });
    await user.click(within(dialog).getByRole('button', { name: 'Save prompt' }));

    expect(within(dialog).getByText('Give the prompt a name.')).toBeInTheDocument();
    expect(ApiClient.createPrompt).not.toHaveBeenCalled();
  });

  it('starts from a starter template', async () => {
    const user = userEvent.setup();
    render(<PromptEditor />);

    await user.click(screen.getByRole('button', { name: 'Starter templates' }));
    await user.click(screen.getByRole('button', { name: /Rewrite my text/ }));

    expect(screen.getAllByLabelText('Section name').map((el) => (el as HTMLInputElement).value)).toEqual([
      'Text',
      'Goal',
      'Keep',
      'Tone',
    ]);
    expect(screen.getByLabelText('Text text')).toHaveValue('{{text}}');
  });

  it('imports text into sections when an AI connection is available', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.parsePromptText).mockResolvedValue({
      fields: [
        { name: 'role', content: 'A careful proofreader' },
        { name: 'task', content: 'Fix typos only' },
      ],
    });
    render(<PromptEditor />);

    await openTool(user, 'Paste a prompt');
    const dialog = await screen.findByRole('dialog', { name: 'Paste a prompt' });
    await user.type(within(dialog).getByLabelText('Prompt to convert'), 'Proofread my text, typos only');
    await user.click(within(dialog).getByRole('button', { name: 'Create template' }));
    await user.click(await screen.findByRole('button', { name: 'Use in editor' }));

    await waitFor(() => expect(screen.getByLabelText('role text')).toHaveValue('A careful proofreader'));
    expect(screen.getByText(/Imported 2 sections/)).toBeInTheDocument();
  });

  it('offers saving as written when no AI connection exists', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: false,
      provider: null,
      provider_label: null,
      model: null,
      available_models: [],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    render(<PromptEditor />);
    await waitFor(() => expect(ApiClient.getPromptsConfig).toHaveBeenCalled());

    await openTool(user, 'Paste a prompt');

    const dialog = await screen.findByRole('dialog', { name: 'Paste a prompt' });
    expect(within(dialog).getByRole('button', { name: 'Save as written' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Create template' })).toBeDisabled();
    expect(ApiClient.parsePromptText).not.toHaveBeenCalled();
  });
});

describe('PromptEditor load errors', () => {
  it('says when a prompt does not exist', async () => {
    vi.mocked(ApiClient.getPromptById).mockRejectedValue(
      new Error('Prompt not found — it may have been deleted.'),
    );
    render(<PromptEditor promptId={99} />);

    expect(await screen.findByRole('heading', { name: 'Prompt not found' })).toBeInTheDocument();
  });
});


it('tries filled draft once without saving and preserves output across errors', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.tryPrompt).mockResolvedValueOnce({ output_text: 'One output', provider: 'openai', model: 'gpt-4.1-mini' });
  await renderSaved();
  await user.type(screen.getByPlaceholderText('Team or project name'), 'Platform');
  await user.click(screen.getByText('Test with AI'));
  await user.click(screen.getByRole('button', { name: 'Try once' }));
  const output = await screen.findByRole('region', { name: 'Try once output' });
  expect(output).toHaveTextContent('One output');
  expect(ApiClient.tryPrompt).toHaveBeenCalledWith(prompt().generated_prompt.replace('{{team}}', 'Platform'));
  expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
  vi.mocked(ApiClient.tryPrompt).mockRejectedValueOnce(new Error('Provider unavailable'));
  await user.type(screen.getByPlaceholderText('Team or project name'), ' team');
  expect(output).toHaveTextContent('Output is from earlier inputs');
  await user.click(screen.getByRole('button', { name: 'Try once' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Provider unavailable');
  expect(screen.queryByRole('link', { name: 'Open Settings' })).not.toBeInTheDocument();
  expect(output).toHaveTextContent('One output');
  vi.mocked(ApiClient.tryPrompt).mockRejectedValueOnce(new Error('OpenAI rejected your API key. Check or replace it in Settings → AI connection.'));
  await user.click(screen.getByRole('button', { name: 'Try once' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('rejected your API key'));
  expect(within(screen.getByRole('alert')).getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings#s-api');
});

describe('paste a prompt recovery and save handoff', () => {
  const conversion = {
    fields: [{ name: 'Task', content: 'Plan a trip to {{destination}}.' }],
    variables: [{ name: 'destination', value: 'Lisbon', description: 'Destination', source_text: 'Lisbon' }],
  };

  async function review(user: ReturnType<typeof userEvent.setup>) {
    vi.mocked(ApiClient.parsePromptText).mockResolvedValue(conversion);
    await openTool(user, 'Paste a prompt');
    fireEvent.change(screen.getByLabelText('Prompt to convert'), { target: { value: 'Plan a trip to Lisbon.' } });
    await user.click(screen.getByRole('button', { name: 'Create template' }));
    await screen.findByRole('button', { name: 'Use in editor' });
  }

  it('recovers source text and edited review without changing the saved prompt or repeating the AI call', async () => {
    const user = userEvent.setup();
    const rendered = render(<PromptEditor promptId={1} />);
    await screen.findByRole('button', { name: 'Weekly status update' });
    await review(user);
    fireEvent.change(screen.getByLabelText('Variable name for destination'), { target: { value: 'city' } });
    fireEvent.change(screen.getByLabelText('Value for destination'), { target: { value: 'Porto' } });
    await user.click(screen.getByRole('checkbox', { name: 'Keep these inputs as examples' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey(1))!).importSession.variables[0].value).toBe('Porto'));
    rendered.unmount();
    render(<PromptEditor promptId={1} />);
    expect(await screen.findByLabelText('Value for destination')).toHaveValue('Porto');
    expect(screen.getByLabelText('Variable name for destination')).toHaveValue('city');
    expect(screen.getByRole('checkbox', { name: 'Keep these inputs as examples' })).toBeChecked();
    expect(screen.getByLabelText('Context text')).toHaveValue(prompt().fields[1].content);
    await user.click(screen.getByRole('button', { name: 'Back to source' }));
    expect(screen.getByLabelText('Prompt to convert')).toHaveValue('Plan a trip to Lisbon.');
    await user.click(screen.getByRole('button', { name: 'Return to review' }));
    expect(ApiClient.parsePromptText).toHaveBeenCalledTimes(1);
    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
  });

  it('recovers applied filled inputs and hands them to a newly saved prompt without saving examples', async () => {
    const user = userEvent.setup();
    const rendered = render(<PromptEditor />);
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Use in editor' }));
    expect(screen.getByRole('tab', { name: 'Fill and copy' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('destination', { exact: true })).toHaveValue('Lisbon');
    expect(screen.getByLabelText('destination', { exact: true })).toHaveFocus();
    expect(screen.getByLabelText('Example input for destination')).toHaveValue('');
    await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey('new'))!).values).toEqual({ destination: 'Lisbon' }));
    rendered.unmount();
    const recovered = render(<PromptEditor />);
    expect(screen.getByLabelText('destination', { exact: true })).toHaveValue('Lisbon');
    expect(screen.getByRole('radio', { name: 'Filled' })).toHaveAttribute('aria-checked', 'true');
    const created = prompt({ id: 2, fields: conversion.fields, variable_metadata: { destination: { type: 'text', description: 'Destination' } } });
    vi.mocked(ApiClient.createPrompt).mockResolvedValue(created);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const saveDialog = screen.getByRole('dialog', { name: 'Save prompt' });
    await user.type(within(saveDialog).getByLabelText('Name'), 'Travel');
    await user.click(within(saveDialog).getByRole('button', { name: 'Save prompt' }));
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/editor/2'));
    expect(ApiClient.createPrompt).toHaveBeenCalledWith(expect.objectContaining({
      fields: conversion.fields, variable_metadata: { destination: { type: 'text', description: 'Destination' } },
    }));
    expect(localStorage.getItem(draftKey('new'))).toBeNull();
    recovered.unmount();
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(created);
    render(<PromptEditor promptId={2} />);
    expect(await screen.findByLabelText('destination', { exact: true })).toHaveValue('Lisbon');
    expect(screen.getByRole('button', { name: 'Edit template' })).toBeInTheDocument();
    expect(screen.getByText('Inputs stay on this device until you clear them.')).toBeInTheDocument();
    expect(screen.queryByText('Your unsaved changes were restored.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Prompt text')).toHaveTextContent('Plan a trip to Lisbon.');
  });

  it('saves explicitly requested examples and restores previous filled inputs and settings with Undo', async () => {
    const user = userEvent.setup();
    await renderSaved();
    await user.type(screen.getByLabelText('team', { exact: true }), 'Payments');
    await review(user);
    await user.click(screen.getByRole('checkbox', { name: 'Keep these inputs as examples' }));
    await user.click(screen.getByRole('button', { name: 'Use in editor' }));
    expect(screen.getByLabelText('Example input for destination')).toHaveValue('Lisbon');
    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('team', { exact: true })).toHaveValue('Payments');
    expect(screen.getByLabelText('Context text')).toHaveValue(prompt().fields[1].content);
    await openTool(user, 'Paste a prompt');
    expect(screen.getByLabelText('Value for destination')).toHaveValue('Lisbon');
    await user.click(screen.getByRole('button', { name: 'Use in editor' }));
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt({ fields: conversion.fields, variable_metadata: {
      destination: { type: 'text', description: 'Destination', example: 'Lisbon' },
    } }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, expect.objectContaining({
      fields: conversion.fields, variable_metadata: { destination: { type: 'text', description: 'Destination', example: 'Lisbon' } },
    })));
  });

  it('does not reopen an undone paste session after leaving the prompt', async () => {
    const user = userEvent.setup();
    const rendered = render(<PromptEditor promptId={1} />);
    await screen.findByRole('button', { name: 'Weekly status update' });
    await user.click(screen.getByRole('button', { name: 'Edit template' }));
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Use in editor' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(localStorage.getItem(draftKey(1)) ?? '').not.toContain('importSession'));
    rendered.unmount();

    render(<PromptEditor promptId={1} />);
    await screen.findByRole('button', { name: 'Weekly status update' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Your unsaved changes were restored.')).not.toBeInTheDocument();
  });

  it('does not overwrite subsequent input edits with import Undo and discards recovered conversion data', async () => {
    const user = userEvent.setup();
    await renderSaved();
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Use in editor' }));
    fireEvent.change(screen.getByLabelText('destination', { exact: true }), { target: { value: 'Porto' } });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Your prompt changed. Undo is no longer available.')).toBeInTheDocument();
    expect(screen.getByLabelText('destination', { exact: true })).toHaveValue('Porto');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(localStorage.getItem(draftKey(1))).toBeNull());
    expect(screen.getByLabelText('Context text')).toHaveValue(prompt().fields[1].content);
  });
});

it('opens Paste a prompt with a note handed over from the library, once', async () => {
  sessionStorage.setItem(pasteHandoffKey(), 'Plan a trip to Lisbon.');
  render(<PromptEditor openImport />);
  expect(await screen.findByLabelText('Prompt to convert')).toHaveValue('Plan a trip to Lisbon.');
  expect(sessionStorage.getItem(pasteHandoffKey())).toBeNull();
});

it('offers the library title and folder on Save and drops a stale draft notice after import', async () => {
  const user = userEvent.setup();
  localStorage.setItem(draftKey('new'), JSON.stringify({ sections: [{ name: 'Task', content: 'Old unsaved idea' }], metadata: {}, values: {} }));
  sessionStorage.setItem(pasteHandoffKey(), JSON.stringify({ text: 'Outline [TOPIC].', title: 'Blog outline', folder: 'Writing' }));
  vi.mocked(ApiClient.parsePromptText).mockResolvedValue({
    fields: [{ name: 'Task', content: 'Outline {{topic}}.' }],
    variables: [{ name: 'topic', value: '', description: 'Topic', source_text: '[TOPIC]' }],
  });
  const { rerender } = render(<PromptEditor openImport />);
  expect(await screen.findByLabelText('Prompt to convert')).toHaveValue('Outline [TOPIC].');
  expect(screen.getByText('Your unsaved changes were restored.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Create template' }));
  expect(await screen.findByText('Some inputs have no value yet. They stay as placeholders when copied.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Use in editor' }));
  // Applying drops ?import=1 from the URL, which re-renders without openImport.
  rerender(<PromptEditor />);
  expect(screen.queryByText('Your unsaved changes were restored.')).not.toBeInTheDocument();
  expect(screen.getByLabelText('topic', { exact: true })).toHaveValue('');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  const saveDialog = screen.getByRole('dialog', { name: 'Save prompt' });
  expect(within(saveDialog).getByLabelText('Name')).toHaveValue('Blog outline');
  expect(within(saveDialog).getByLabelText('Folder')).toHaveValue('Writing');
});

it('consumes the library import URL when applying so reload opens the recovered filled prompt', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.parsePromptText).mockResolvedValue({
    fields: [{ name: 'Task', content: 'Go to {{city}}.' }],
    variables: [{ name: 'city', value: 'Lisbon', description: 'Destination', source_text: 'Lisbon' }],
  });
  render(<PromptEditor openImport />);
  fireEvent.change(await screen.findByLabelText('Prompt to convert'), { target: { value: 'Go to Lisbon.' } });
  await user.click(screen.getByRole('button', { name: 'Create template' }));
  await user.click(await screen.findByRole('button', { name: 'Use in editor' }));
  expect(routerReplace).toHaveBeenCalledWith('/editor/new', { scroll: false });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('city', { exact: true })).toHaveValue('Lisbon');
});

it('keeps import Undo available when loading unchanged example inputs', async () => {
  const user = userEvent.setup();
  await renderSaved();
  await user.type(screen.getByLabelText('team', { exact: true }), 'Payments');
  vi.mocked(ApiClient.parsePromptText).mockResolvedValue({
    fields: [{ name: 'Task', content: 'Plan a {{duration}} trip to {{city}}.' }],
    variables: [
      { name: 'city', value: 'Lisbon', description: 'Destination', source_text: 'Lisbon' },
      { name: 'duration', value: '3-day', description: 'Length', source_text: '3-day' },
    ],
  });
  await openTool(user, 'Paste a prompt');
  fireEvent.change(screen.getByLabelText('Prompt to convert'), { target: { value: 'Plan a 3-day trip to Lisbon.' } });
  await user.click(screen.getByRole('button', { name: 'Create template' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Keep these inputs as examples' }));
  await user.click(screen.getByRole('button', { name: 'Use in editor' }));
  await user.click(screen.getByRole('button', { name: 'Load example inputs' }));
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByLabelText('Context text')).toHaveValue(prompt().fields[1].content);
  expect(screen.getByLabelText('team', { exact: true })).toHaveValue('Payments');
});

it('discards template edits while preserving matching filled inputs and forgetting removed variables', async () => {
  const user = userEvent.setup();
  await renderSaved();
  fireEvent.change(screen.getByLabelText('team', { exact: true }), { target: { value: 'Payments' } });
  fireEvent.change(screen.getByLabelText('Context text'), { target: { value: 'Team: {{team}} New: {{temporary}}' } });
  fireEvent.change(screen.getByLabelText('temporary', { exact: true }), { target: { value: 'Temporary value' } });
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.getByLabelText('team', { exact: true })).toHaveValue('Payments');
  fireEvent.change(screen.getByLabelText('Context text'), { target: { value: 'Team: {{team}} New: {{temporary}}' } });
  expect(screen.getByLabelText('temporary', { exact: true })).toHaveValue('');
});

it('opens saved prompts with inputs ready to fill and remembers inputs on this device', async () => {
  const user = userEvent.setup();
  const first = render(<PromptEditor promptId={1} />);
  await screen.findByRole('button', { name: 'Weekly status update' });
  expect(screen.getByLabelText('Context text').closest('fieldset')).toHaveAttribute('hidden');
  await user.type(screen.getByPlaceholderText('Team or project name'), 'Platform');
  expect(screen.getByText('Inputs stay on this device until you clear them.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit template' }));
  expect(screen.getByLabelText('Context text').closest('fieldset')).not.toHaveAttribute('hidden');
  expect(screen.getByPlaceholderText('Team or project name')).toHaveValue('Platform');
  first.unmount();

  render(<PromptEditor promptId={1} />);
  expect(await screen.findByPlaceholderText('Team or project name')).toHaveValue('Platform');
  await user.click(screen.getByRole('button', { name: 'Clear inputs' }));
  expect(localStorage.getItem(draftKey(1))).toBeNull();
});

it('keeps restored template edits and prompts without inputs in the editor', async () => {
  const saved = prompt();
  localStorage.setItem(draftKey(1), JSON.stringify({
    base: snapshot(saved.fields, saved.variable_metadata),
    sections: [{ name: 'Role', content: 'Edited role' }, saved.fields[1]],
    metadata: saved.variable_metadata, note: '',
  }));
  const first = render(<PromptEditor promptId={1} />);
  await screen.findByText('Your unsaved changes were restored.');
  expect(screen.getByLabelText('Role text').closest('fieldset')).not.toHaveAttribute('hidden');
  first.unmount();

  localStorage.clear();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt({ fields: [{ name: 'Task', content: 'No inputs here.' }] }));
  render(<PromptEditor promptId={1} />);
  await screen.findByRole('button', { name: 'Weekly status update' });
  expect(screen.getByLabelText('Task text').closest('fieldset')).not.toHaveAttribute('hidden');
  expect(screen.queryByRole('button', { name: 'Edit template' })).not.toBeInTheDocument();
});

it('turns selected text into an input and keeps it as the example', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt({ fields: [{ name: 'Task', content: 'Plan a trip to Lisbon.' }], variable_metadata: null }));
  await renderSaved();
  const text = screen.getByLabelText('Task text') as HTMLTextAreaElement;
  await user.click(text);
  text.setSelectionRange(15, 21);
  await user.click(screen.getByRole('button', { name: 'Insert input in Task' }));
  const name = screen.getByLabelText('Input name for “Lisbon” (kept as its example)');
  await user.type(name, '2 cities');
  await user.click(screen.getByRole('button', { name: 'Insert' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Start with a letter');
  await user.clear(name);
  await user.type(name, 'Destination City{Enter}');
  expect(text).toHaveValue('Plan a trip to {{destination_city}}.');
  expect(text).toHaveFocus();
  expect(screen.getByLabelText('Example input for destination_city')).toHaveValue('Lisbon');

  await user.click(screen.getByRole('button', { name: 'Insert input in Task' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByLabelText('New input name')).not.toBeInTheDocument();
  expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
});

it('opens library filled links in a focused pane with an explicit edit action', async () => {
  const user = userEvent.setup();
  render(<PromptEditor promptId={1} initialMode="filled" />);
  await screen.findByRole('button', { name: 'Weekly status update' });
  expect(screen.getByRole('button', { name: 'Edit template' })).toBeInTheDocument();
  expect(screen.getByLabelText('Context text').closest('fieldset')).toHaveAttribute('hidden');
  await user.click(screen.getByRole('button', { name: 'Edit template' }));
  expect(screen.getByLabelText('Context text').closest('fieldset')).not.toHaveAttribute('hidden');
});


it('checks the connection before showing a disconnected warning and distinguishes failures', async () => {
  const user = userEvent.setup();
  let reject!: (reason: Error) => void;
  vi.mocked(ApiClient.getPromptsConfig).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  render(<PromptEditor openImport />);
  expect(within(screen.getByRole('dialog', { name: 'Paste a prompt' })).getByText('Checking AI connection…')).toBeInTheDocument();
  expect(screen.queryByText(/Connect an AI provider in Settings/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Prompt to convert'), { target: { value: '  Write a weekly update.\nKeep formatting.  ' } });
  reject(new Error('Offline'));
  expect(await within(screen.getByRole('dialog', { name: 'Paste a prompt' })).findByText(/Could not check the AI connection/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save as written' }));
  const save = screen.getByRole('dialog', { name: 'Save prompt' });
  expect(within(save).getByLabelText('Name')).toHaveValue('Write a weekly update.');
  expect(screen.getByLabelText('Task text')).toHaveValue('  Write a weekly update.\nKeep formatting.  ');
  await user.clear(within(save).getByLabelText('Name'));
  await user.type(within(save).getByLabelText('Name'), 'My weekly update');
  expect(within(save).getByLabelText('Name')).toHaveValue('My weekly update');
  expect(ApiClient.parsePromptText).not.toHaveBeenCalled();
});

it('keeps recovered filled inputs after discard until explicitly cleared', async () => {
  const user = userEvent.setup();
  const saved = prompt();
  localStorage.setItem(draftKey(1), JSON.stringify({
    base: JSON.stringify({ fields: saved.fields, metadata: [['team', saved.variable_metadata!.team]] }),
    sections: [{ name: 'Context', content: '{{team}} {{temporary}}' }], metadata: {},
    values: { team: 'Payments', temporary: 'Private temporary value' },
  }));
  await renderSaved();
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey(1))!).values).toEqual({ team: 'Payments' }));
  expect(screen.getByLabelText('team', { exact: true })).toHaveValue('Payments');
  await user.click(screen.getByRole('button', { name: 'Clear inputs' }));
  expect(screen.getByLabelText('team', { exact: true })).toHaveValue('');
  await waitFor(() => expect(localStorage.getItem(draftKey(1))).toBeNull());
  expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
});
