import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EvaluateTab from '../EvaluateTab';
import { ApiClient } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { EvalCase, EvalRun, PromptHistoryResponse } from '@/types/prompt';
import { User } from '@/types/auth';

vi.mock('@/lib/api', () => ({
  ApiClient: {
    listEvalCases: vi.fn(),
    listEvalRuns: vi.fn(),
    createEvalCase: vi.fn(),
    updateEvalCase: vi.fn(),
    deleteEvalCase: vi.fn(),
    createEvalRun: vi.fn(),
    rateEvalResult: vi.fn(),
    importEvalCases: vi.fn(),
    exportEvalCases: vi.fn(),
    getPromptsConfig: vi.fn(),
    generateEvalCases: vi.fn(),
  },
}));

function prompt(overrides: Partial<PromptHistoryResponse> = {}): PromptHistoryResponse {
  return {
    id: 1,
    name: 'P',
    fields: [],
    generated_prompt: 'Say {{thing}}',
    created_at: '2026-07-01T00:00:00Z',
    run_count: 0,
    ...overrides,
  };
}

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 1,
    prompt_id: 1,
    method: 'rule',
    criteria: 'hello',
    variables: {},
    position: 0,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const user: User = { id: 1, username: 'u', created_at: '2026-07-01T00:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ApiClient.listEvalCases).mockResolvedValue([]);
  vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([]);
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: true,
    provider: 'openai',
    provider_label: 'OpenAI',
    model: 'gpt-4o-mini',
    available_models: ['gpt-4o-mini'],
    budget_exhausted: false,
    global_budget_remaining_usd: null,
  });
  vi.mocked(ApiClient.updateEvalCase).mockImplementation(async (_promptId, _caseId, patch) =>
    evalCase(patch),
  );
});

describe('EvaluateTab', () => {
  it('loads and renders eval cases', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(await screen.findByDisplayValue('hello')).toBeInTheDocument();
  });

  it('buffers rapid Rule criteria typing without dropping characters', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase({ criteria: '' })]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    const criteria = await screen.findByLabelText('rule criteria');

    await userEvent.type(criteria, 'eco-friendly, !cheap, ~warranty');

    expect(criteria).toHaveValue('eco-friendly, !cheap, ~warranty');
    expect(ApiClient.updateEvalCase).not.toHaveBeenCalled();
    await userEvent.tab();
    await waitFor(() =>
      expect(ApiClient.updateEvalCase).toHaveBeenLastCalledWith(1, 1, {
        criteria: 'eco-friendly, !cheap, ~warranty',
      }),
    );
  });

  it('buffers rapid eval variable typing and clears the case-aware preflight warning', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    const variableInput = await screen.findByLabelText('thing value');
    expect(screen.getByText(/1 eval case still needs values/)).toBeInTheDocument();

    await userEvent.type(variableInput, 'Reusable Water Bottle');

    expect(variableInput).toHaveValue('Reusable Water Bottle');
    expect(screen.queryByText(/eval case still needs values/)).not.toBeInTheDocument();
    await userEvent.tab();
    await waitFor(() =>
      expect(ApiClient.updateEvalCase).toHaveBeenLastCalledWith(1, 1, {
        variables: { thing: 'Reusable Water Bottle' },
      }),
    );
  });

  it('shows the empty state with no cases', async () => {
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    expect(await screen.findByText(/No eval cases yet/)).toBeInTheDocument();
  });

  it('disables Run evaluation with no cases', async () => {
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    await screen.findByText(/No eval cases yet/);
    expect(screen.getByRole('button', { name: /Run evaluation/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Run evaluation/ })).toHaveAttribute(
      'title',
      'Add at least one eval case to run an evaluation.',
    );
  });

  it('disables Run evaluation and shows a notice when the budget is exhausted', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini'],
      budget_exhausted: true,
      global_budget_remaining_usd: 0,
    });
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(await screen.findByText(/monthly API budget has been reached/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run evaluation/ })).toBeDisabled();
  });

  it('disables runs and suggestions with a Settings link when no provider is connected', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: false,
      provider: null,
      provider_label: null,
      model: null,
      available_models: [],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(await screen.findByText(/need an AI provider/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect one in Settings/ })).toHaveAttribute(
      'href',
      '/settings#s-api',
    );
    expect(screen.getByRole('button', { name: /Run evaluation/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Suggest eval cases/ })).toBeDisabled();
  });

  it('adds a case defaulting to the user default eval method', async () => {
    vi.mocked(ApiClient.createEvalCase).mockResolvedValue(evalCase({ method: 'judge' }));
    render(
      <EvaluateTab
        prompt={prompt()}
        currentUser={{ ...user, default_eval_method: 'judge' }}
      />
    );
    await screen.findByText(/No eval cases yet/);

    await userEvent.click(screen.getByRole('button', { name: '+ Add case' }));

    await waitFor(() =>
      expect(ApiClient.createEvalCase).toHaveBeenCalledWith(1, {
        method: 'judge',
        criteria: '',
        variables: {},
      })
    );
  });

  it('removes a case', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    await screen.findByDisplayValue('hello');

    await userEvent.click(screen.getByLabelText('Remove case'));

    await waitFor(() => expect(ApiClient.deleteEvalCase).toHaveBeenCalledWith(1, 1));
  });

  it('imports CSV cases and renders them', async () => {
    const imported = evalCase({ id: 2, criteria: 'imported' });
    vi.mocked(ApiClient.importEvalCases).mockResolvedValue([imported]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    await screen.findByText(/No eval cases yet/);

    const file = new File(['method,criteria\nrule,imported\n'], 'cases.csv', {
      type: 'text/csv',
    });
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve('method,criteria\nrule,imported\n'),
    });
    await userEvent.upload(screen.getByLabelText('Import eval cases CSV'), file);

    await waitFor(() =>
      expect(ApiClient.importEvalCases).toHaveBeenCalledWith(
        1,
        'method,criteria\nrule,imported\n'
      )
    );
    expect(await screen.findByDisplayValue('imported')).toBeInTheDocument();
  });

  it('exports cases as a CSV download', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    const blob = new Blob(['method,criteria\n']);
    vi.mocked(ApiClient.exportEvalCases).mockResolvedValue(blob);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    await screen.findByDisplayValue('hello');

    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(ApiClient.exportEvalCases).toHaveBeenCalledWith(1));
    // Asserted at the download boundary: clicking a synthesised <a download> is
    // unimplemented in jsdom, and spying on the anchor left the blob-URL
    // lifecycle assertions coupled to that workaround.
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'prompt-1-eval-cases.csv');
  });

  it('runs an evaluation and shows the resulting score', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    const run: EvalRun = {
      id: 10,
      prompt_id: 1,
      prompt_version_number: 1,
      score: 100,
      created_at: '2026-07-02T00:00:00Z',
      model: 'gpt-4o-mini',
      total_latency_ms: 42,
      total_prompt_tokens: 10,
      total_completion_tokens: 5,
      total_cost_usd: 0.001,
      results: [
        {
          id: 100,
          eval_case_id: 1,
          method: 'rule',
          label: 'hello',
          rationale: 'Found: hello',
          score: 100,
          is_pending: false,
          output_text: 'hello there',
        },
      ],
    };
    vi.mocked(ApiClient.createEvalRun).mockResolvedValue(run);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    await screen.findByDisplayValue('hello');

    await userEvent.click(screen.getByRole('button', { name: /Run evaluation/ }));

    await waitFor(() => expect(screen.getAllByText('100').length).toBeGreaterThan(0));
    expect(screen.queryByText(/No evaluation runs yet/)).not.toBeInTheDocument();
  });

  it('renders a star rating for a pending manual result and submits it', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase({ method: 'manual', criteria: null })]);
    const pendingRun: EvalRun = {
      id: 10,
      prompt_id: 1,
      prompt_version_number: 1,
      score: null,
      created_at: '2026-07-02T00:00:00Z',
      model: 'gpt-4o-mini',
      total_latency_ms: 10,
      total_prompt_tokens: 5,
      total_completion_tokens: 2,
      total_cost_usd: 0.0002,
      results: [
        {
          id: 100,
          eval_case_id: 1,
          method: 'manual',
          label: 'Case 1',
          rationale: null,
          score: null,
          is_pending: true,
          output_text: 'anything',
        },
      ],
    };
    vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([pendingRun]);
    vi.mocked(ApiClient.rateEvalResult).mockResolvedValue({
      ...pendingRun,
      score: 80,
      results: [{ ...pendingRun.results[0], score: 80, is_pending: false }],
    });
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    await screen.findByText('Awaiting ratings');
    await userEvent.click(screen.getByLabelText('4 stars'));

    await waitFor(() =>
      expect(ApiClient.rateEvalResult).toHaveBeenCalledWith(1, 10, 100, { stars: 4 })
    );
  });

  function makeRun(overrides: Partial<EvalRun> = {}): EvalRun {
    return {
      id: 10,
      prompt_id: 1,
      prompt_version_number: 1,
      score: 100,
      created_at: '2026-07-02T00:00:00Z',
      model: 'gpt-4o-mini',
      total_latency_ms: 100,
      total_prompt_tokens: 10,
      total_completion_tokens: 5,
      total_cost_usd: 0.001,
      results: [
        {
          id: 100,
          eval_case_id: 1,
          method: 'rule',
          label: 'Case 1',
          rationale: 'Found: hello',
          score: 100,
          is_pending: false,
          output_text: 'hello there',
          criteria: 'hello',
        },
      ],
      ...overrides,
    };
  }

  it('opens the latest run detail automatically', async () => {
    vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([makeRun()]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(await screen.findByText('Run detail — v1')).toBeInTheDocument();
    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(screen.getByLabelText(/Select run v1/)).toBeChecked();
  });

  it('shows a comparison with deltas when two runs are selected', async () => {
    const runA = makeRun({
      id: 10,
      prompt_version_number: 1,
      created_at: '2026-07-01T00:00:00Z',
      model: 'gpt-4o-mini',
      total_latency_ms: 100,
      total_prompt_tokens: 10,
      total_completion_tokens: 5,
      total_cost_usd: 0.001,
      results: [
        {
          id: 100,
          eval_case_id: 1,
          method: 'rule',
          label: 'Case 1',
          rationale: 'Found: hello',
          score: 80,
          is_pending: false,
          output_text: 'first output',
          criteria: 'hello',
        },
      ],
    });
    const runB = makeRun({
      id: 11,
      prompt_version_number: 2,
      created_at: '2026-07-02T00:00:00Z',
      model: 'gpt-4o',
      total_latency_ms: 150,
      total_prompt_tokens: 20,
      total_completion_tokens: 10,
      total_cost_usd: 0.002,
      results: [
        {
          id: 101,
          eval_case_id: 1,
          method: 'rule',
          label: 'Case 1',
          rationale: 'Found: hello',
          score: 100,
          is_pending: false,
          output_text: 'second output',
          criteria: 'hello',
        },
      ],
    });
    vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([runB, runA]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    await userEvent.click(await screen.findByLabelText(/Select run v1/));

    expect(await screen.findByText('Comparing v1 → v2')).toBeInTheDocument();
    expect(screen.getByText('first output')).toBeInTheDocument();
    expect(screen.getByText('second output')).toBeInTheDocument();
    expect(screen.getByText('Δ score +20')).toBeInTheDocument();
  });

  it('shows a per-method score breakdown for a mixed-method run', async () => {
    const mixedRun = makeRun({
      score: null,
      results: [
        {
          id: 100,
          eval_case_id: 1,
          method: 'rule',
          label: 'Rule A',
          rationale: 'Passed: hello',
          score: 60,
          is_pending: false,
          output_text: 'x',
        },
        {
          id: 101,
          eval_case_id: 2,
          method: 'rule',
          label: 'Rule B',
          rationale: 'Passed: hello',
          score: 80,
          is_pending: false,
          output_text: 'x',
        },
        {
          id: 102,
          eval_case_id: 3,
          method: 'judge',
          label: 'Judge A',
          rationale: null,
          score: 82,
          is_pending: false,
          output_text: 'x',
        },
        {
          id: 103,
          eval_case_id: 4,
          method: 'manual',
          label: 'Manual A',
          rationale: null,
          score: null,
          is_pending: true,
          output_text: 'x',
        },
      ],
    });
    vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([mixedRun]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(await screen.findByText(/avg 70/)).toBeInTheDocument();
    expect(screen.getByText(/avg 82/)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
  });

  it('shows "No score" instead of "Awaiting ratings" when nothing is pending', async () => {
    const failedRun = makeRun({
      score: null,
      results: [
        {
          id: 100,
          eval_case_id: 1,
          method: 'rule',
          label: 'Case 1',
          rationale: 'Model run failed: boom',
          score: null,
          is_pending: false,
          output_text: null,
        },
      ],
    });
    vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([failedRun]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(await screen.findByText('No score')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting ratings')).not.toBeInTheDocument();
  });

  it('shows the Debug button only for results below the threshold', async () => {
    const run = makeRun({
      results: [
        {
          id: 100,
          eval_case_id: 1,
          method: 'rule',
          label: 'Failing case',
          rationale: 'Failed: hello',
          score: 40,
          is_pending: false,
          output_text: 'x',
          variables: { thing: 'a' },
        },
        {
          id: 101,
          eval_case_id: 2,
          method: 'judge',
          label: 'Decent case',
          rationale: null,
          score: 85,
          is_pending: false,
          output_text: 'x',
        },
      ],
    });
    vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([run]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    await screen.findByText('Failing case');
    expect(screen.getAllByRole('button', { name: /Debug/ })).toHaveLength(1);
  });

  it('includes the evaluated model and variables in the Debug deep-link', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([
      makeRun({
        model: 'gpt-4o',
        results: [
          {
            id: 100,
            eval_case_id: 1,
            method: 'rule',
            label: 'Failing case',
            rationale: 'Failed: hello',
            score: 40,
            is_pending: false,
            output_text: 'x',
            variables: { thing: 'water bottle' },
          },
        ],
      }),
    ]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    await userEvent.click(await screen.findByRole('button', { name: /Debug/ }));

    expect(open).toHaveBeenCalledWith(
      '/playground/1?var_thing=water+bottle&model=gpt-4o',
      '_blank',
    );
    open.mockRestore();
  });

  it('renders judge rationale JSON as text with strength/weakness chips', async () => {
    const run = makeRun({
      results: [
        {
          id: 100,
          eval_case_id: 1,
          method: 'judge',
          label: 'Judge case',
          rationale: JSON.stringify({
            text: 'Mostly on-topic.',
            strengths: ['clear'],
            weaknesses: ['verbose'],
          }),
          score: 75,
          is_pending: false,
          output_text: 'x',
        },
      ],
    });
    vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([run]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(await screen.findByText('Mostly on-topic.')).toBeInTheDocument();
    expect(screen.getByText('+clear')).toBeInTheDocument();
    expect(screen.getByText('-verbose')).toBeInTheDocument();
  });

  it('uses formatted judge rationale in the run-detail panel too', async () => {
    const rationale = JSON.stringify({
      text: 'Mostly on-topic.',
      strengths: ['clear'],
      weaknesses: ['verbose'],
    });
    vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([
      makeRun({
        results: [
          {
            id: 100,
            eval_case_id: 1,
            method: 'judge',
            label: 'Judge case',
            rationale,
            score: 75,
            is_pending: false,
            output_text: 'x',
          },
        ],
      }),
    ]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(screen.queryByText(rationale)).not.toBeInTheDocument();
    expect(await screen.findByText('Mostly on-topic.')).toBeInTheDocument();
    expect(screen.getByText('+clear')).toBeInTheDocument();
  });

  it('explains the rule operators under a rule case', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    await screen.findByDisplayValue('hello');
    expect(screen.getByText(/!text must not appear/)).toBeInTheDocument();
    expect(screen.getByText(/1 check: contains “hello”/)).toBeInTheDocument();
  });

  it('prominently explains each scoring method as the selection changes', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(await screen.findByRole('note', { name: 'Rule scoring description' }))
      .toHaveTextContent('Exact checks, instant score');

    await userEvent.click(screen.getByRole('radio', { name: /^Judge/ }));
    expect(screen.getByRole('note', { name: 'Judge scoring description' }))
      .toHaveTextContent('An AI judge grades the output 0–100');

    await userEvent.click(screen.getByRole('radio', { name: /^Manual/ }));
    expect(screen.getByRole('note', { name: 'Manual scoring description' }))
      .toHaveTextContent('Scored manually after each run');
  });

  it('validates a malformed rule regex before an evaluation run', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([
      evalCase({ criteria: '~[unclosed' }),
    ]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid regex');
  });

  it('generates proposals and does not add them to the eval set until accepted', async () => {
    vi.mocked(ApiClient.generateEvalCases).mockResolvedValue({
      proposals: [
        {
          method: 'rule',
          name: 'Happy path: greeting',
          criteria: 'hello',
          variables: { thing: 'hello' },
          rationale: 'Happy path.',
        },
        {
          method: 'judge',
          name: 'Edge case: empty input',
          criteria: 'Be concise',
          variables: { thing: '' },
          rationale: 'Edge case: empty input.',
        },
      ],
    });
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    await screen.findByText(/No eval cases yet/);

    await userEvent.click(screen.getByRole('button', { name: /Suggest eval cases/ }));

    await waitFor(() => expect(ApiClient.generateEvalCases).toHaveBeenCalledWith(1, { goal: null }));
    expect(await screen.findByText('Happy path.')).toBeInTheDocument();
    expect(screen.getByText('Edge case: empty input.')).toBeInTheDocument();
    expect(ApiClient.createEvalCase).not.toHaveBeenCalled();
  });

  it('accepts a proposal, persisting only that one case', async () => {
    vi.mocked(ApiClient.generateEvalCases).mockResolvedValue({
      proposals: [
        {
          method: 'rule',
          name: 'Happy path: greeting',
          criteria: 'hello',
          variables: { thing: 'hello' },
          rationale: 'Happy path.',
        },
      ],
    });
    vi.mocked(ApiClient.createEvalCase).mockResolvedValue(evalCase({ id: 5, criteria: 'hello' }));
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    await screen.findByText(/No eval cases yet/);

    await userEvent.click(screen.getByRole('button', { name: /Suggest eval cases/ }));
    await screen.findByText('Happy path.');
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() =>
      expect(ApiClient.createEvalCase).toHaveBeenCalledWith(1, {
        method: 'rule',
        name: 'Happy path: greeting',
        criteria: 'hello',
        variables: { thing: 'hello' },
        intentionally_empty: false,
      })
    );
    await waitFor(() => expect(screen.queryByText('Happy path.')).not.toBeInTheDocument());
  });

  it('never puts a mid-word slice of the rationale in a proposal name', async () => {
    const rationale =
      'This standard happy-path case tests that the prompt can produce a concise triage note including requested details.';
    vi.mocked(ApiClient.generateEvalCases).mockResolvedValue({
      proposals: [
        { method: 'rule', name: '', criteria: 'hello', variables: { thing: 'hi' }, rationale },
      ],
    });
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    await screen.findByText(/No eval cases yet/);

    await userEvent.click(screen.getByRole('button', { name: /Suggest eval cases/ }));
    await screen.findByText(rationale);

    const nameField = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(nameField.value.length).toBeLessThan(rationale.length);
    // The last word must be whole — the defect persisted names ending "…requ".
    expect(rationale.split(/\s+/)).toContain(nameField.value.split(/\s+/).pop());
  });

  it('suppresses missing-variable preflight only for an explicit intentionally-empty case', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([
      evalCase({ intentionally_empty: true, variables: {} }),
    ]);
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);

    await screen.findByDisplayValue('hello');
    expect(screen.queryByText(/eval case still needs values/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Empty values are intentional/ }),
    ).toBeChecked();
  });

  it('uses a number input for Number-typed eval variables', async () => {
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([evalCase()]);
    render(
      <EvaluateTab
        prompt={prompt({
          variable_metadata: { thing: { type: 'number', description: null } },
        })}
        currentUser={user}
      />,
    );

    expect(await screen.findByLabelText('thing value')).toHaveAttribute('type', 'number');
  });

  it('rejects a proposal without persisting it', async () => {
    vi.mocked(ApiClient.generateEvalCases).mockResolvedValue({
      proposals: [
        {
          method: 'rule',
          name: 'Happy path: greeting',
          criteria: 'hello',
          variables: { thing: 'hello' },
          rationale: 'Happy path.',
        },
      ],
    });
    render(<EvaluateTab prompt={prompt()} currentUser={user} />);
    await screen.findByText(/No eval cases yet/);

    await userEvent.click(screen.getByRole('button', { name: /Suggest eval cases/ }));
    await screen.findByText('Happy path.');
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(screen.queryByText('Happy path.')).not.toBeInTheDocument());
    expect(ApiClient.createEvalCase).not.toHaveBeenCalled();
  });
});
