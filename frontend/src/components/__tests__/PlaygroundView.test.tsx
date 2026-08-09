import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlaygroundView from '../PlaygroundView';
import { ApiClient } from '@/lib/api';

vi.mock('@/lib/api', async () => ({
  // Keep the module's pure helpers (isValidPromptId, PROMPT_NOT_FOUND_MESSAGE)
  // real — only the network client is stubbed.
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  ApiClient: {
    getPromptById: vi.fn(),
    getPromptsConfig: vi.fn(),
    runPlayground: vi.fn(),
    getPlaygroundRuns: vi.fn(),
  },
}));

function prompt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Customer Support Triage',
    fields: [{ name: 'goal', content: 'triage' }],
    generated_prompt: '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-08T00:00:00Z',
    run_count: 0,
    variable_metadata: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt());
  vi.mocked(ApiClient.getPlaygroundRuns).mockResolvedValue([]);
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: true,
    provider: 'openai',
    provider_label: 'OpenAI',
    model: 'gpt-4o-mini',
    available_models: ['gpt-4o-mini'],
    budget_exhausted: false,
    global_budget_remaining_usd: null,
  });
});

describe('PlaygroundView loading', () => {
  it('renders a terminal not-found state', async () => {
    vi.mocked(ApiClient.getPromptById).mockRejectedValue(
      new Error('Prompt not found — it may have been deleted.'),
    );

    render(<PlaygroundView promptId={99999} />);

    expect(await screen.findByRole('heading', { name: 'Prompt not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Library' })).toHaveAttribute('href', '/library');
  });
});

describe('PlaygroundView', () => {
  it('renders a model select and one input per detected variable', async () => {
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini', 'gpt-4o'],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });

    render(<PlaygroundView promptId={1} />);

    expect(await screen.findByLabelText('Model')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gpt-4o-mini' })).toBeInTheDocument();
    expect(screen.getByLabelText('ticket_text')).toBeInTheDocument();
  });

  it('hydrates the model and variables supplied by an evaluation Debug link', async () => {
    window.history.replaceState(
      {},
      '',
      '/playground/1?var_ticket_text=failed+input&model=gpt-4o',
    );
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini', 'gpt-4o'],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });

    render(<PlaygroundView promptId={1} />);

    expect(await screen.findByLabelText('Model')).toHaveValue('gpt-4o');
    expect(screen.getByLabelText('ticket_text')).toHaveValue('failed input');
  });

  it('shows a connect-a-provider notice and disables Run when no provider is connected', async () => {
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: false,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: [],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });

    render(<PlaygroundView promptId={1} />);

    expect(await screen.findByText(/needs an AI provider/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('shows a disabled notice and disables Run when the budget is exhausted', async () => {
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini'],
      budget_exhausted: true,
      global_budget_remaining_usd: 0,
    });

    render(<PlaygroundView promptId={1} />);

    expect(await screen.findByText(/monthly API budget has been reached/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('runs with the compiled variables and shows output plus metrics', async () => {
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini'],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    vi.mocked(ApiClient.runPlayground).mockResolvedValue({
      output_text: 'Here is the triage result.',
      latency_ms: 842,
      prompt_tokens: 120,
      completion_tokens: 40,
      cost_usd: 0.000042,
      model: 'gpt-4o-mini',
    });

    render(<PlaygroundView promptId={1} />);
    await screen.findByLabelText('Model');

    await userEvent.type(screen.getByLabelText('ticket_text'), 'billing issue');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(ApiClient.runPlayground).toHaveBeenCalledWith(1, {
        model: 'gpt-4o-mini',
        variables: { ticket_text: 'billing issue' },
      });
    });

    expect(await screen.findByText('Here is the triage result.')).toBeInTheDocument();
    expect(screen.getByText(/842ms/)).toBeInTheDocument();
  });

  it('renders a number input for a number-typed variable and includes it when run', async () => {
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(
      prompt({ variable_metadata: { ticket_text: { type: 'number', description: null } } })
    );
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini'],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    vi.mocked(ApiClient.runPlayground).mockResolvedValue({
      output_text: 'ok',
      latency_ms: 10,
      prompt_tokens: 1,
      completion_tokens: 1,
      cost_usd: 0,
      model: 'gpt-4o-mini',
    });

    render(<PlaygroundView promptId={1} />);
    const input = await screen.findByLabelText('ticket_text');
    expect(input).toHaveAttribute('type', 'number');

    await userEvent.type(input, '42');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(ApiClient.runPlayground).toHaveBeenCalledWith(1, {
        model: 'gpt-4o-mini',
        variables: { ticket_text: '42' },
      });
    });
  });

  it('renders a toggle for a boolean-typed variable and sends true/false as a string', async () => {
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(
      prompt({ variable_metadata: { ticket_text: { type: 'boolean', description: null } } })
    );
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini'],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    vi.mocked(ApiClient.runPlayground).mockResolvedValue({
      output_text: 'ok',
      latency_ms: 10,
      prompt_tokens: 1,
      completion_tokens: 1,
      cost_usd: 0,
      model: 'gpt-4o-mini',
    });

    render(<PlaygroundView promptId={1} />);
    await screen.findByLabelText('Model');

    await userEvent.click(screen.getByRole('switch', { name: 'ticket_text' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(ApiClient.runPlayground).toHaveBeenCalledWith(1, {
        model: 'gpt-4o-mini',
        variables: { ticket_text: 'true' },
      });
    });
  });

  it('loads a past run\'s model and inputs back into the form from the history drawer', async () => {
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini', 'gpt-4o'],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    vi.mocked(ApiClient.getPlaygroundRuns).mockResolvedValue([
      {
        id: 5,
        model: 'gpt-4o',
        input_variables: { ticket_text: 'past run input' },
        output_text: 'past output',
        latency_ms: 500,
        prompt_tokens: 10,
        completion_tokens: 5,
        cost_usd: 0.0001,
        status: 'success',
        error_message: null,
        created_at: '2026-07-10T00:00:00Z',
      },
    ]);

    render(<PlaygroundView promptId={1} />);
    await screen.findByLabelText('Model');

    await userEvent.click(screen.getByRole('button', { name: /History/ }));
    await userEvent.click(await screen.findByRole('button', { name: /gpt-4o/ }));

    expect(screen.getByLabelText('Model')).toHaveValue('gpt-4o');
    expect(screen.getByLabelText('ticket_text')).toHaveValue('past run input');
  });

  it('refreshes history after a new run so it appears immediately', async () => {
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini'],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    vi.mocked(ApiClient.runPlayground).mockResolvedValue({
      output_text: 'ok',
      latency_ms: 10,
      prompt_tokens: 1,
      completion_tokens: 1,
      cost_usd: 0,
      model: 'gpt-4o-mini',
    });

    render(<PlaygroundView promptId={1} />);
    await screen.findByLabelText('Model');
    const callsBeforeRun = vi.mocked(ApiClient.getPlaygroundRuns).mock.calls.length;

    await userEvent.type(screen.getByLabelText('ticket_text'), 'test input');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() =>
      expect(vi.mocked(ApiClient.getPlaygroundRuns).mock.calls.length).toBe(callsBeforeRun + 1),
    );
  });

  it('enables Run with an untouched Boolean toggle and sends it as false', async () => {
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(
      prompt({
        generated_prompt: '<GOAL>\ntriage {{is_urgent}}\n</GOAL>',
        variable_metadata: { is_urgent: { type: 'boolean', description: null } },
      }),
    );
    vi.mocked(ApiClient.runPlayground).mockResolvedValue({
      output_text: 'ok',
      latency_ms: 1,
      prompt_tokens: 1,
      completion_tokens: 1,
      cost_usd: 0,
      model: 'gpt-4o-mini',
    });

    render(<PlaygroundView promptId={1} />);
    await screen.findByLabelText('Model');

    expect(screen.queryByText(/Missing a value/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() =>
      expect(ApiClient.runPlayground).toHaveBeenCalledWith(1, {
        model: 'gpt-4o-mini',
        variables: { is_urgent: 'false' },
      }),
    );
  });

  it('keeps Run available while preflight warns about a missing value', async () => {
    // Preflight is advisory at every entry point — it must surface the warning
    // without taking the action away.
    render(<PlaygroundView promptId={1} />);
    await screen.findByLabelText('Model');

    expect(await screen.findByText(/Missing a value for ticket_text/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
  });

  it('shows an error banner when the run fails', async () => {
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: ['gpt-4o-mini'],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    vi.mocked(ApiClient.runPlayground).mockRejectedValue(new Error('Playground run failed.'));

    render(<PlaygroundView promptId={1} />);
    await screen.findByLabelText('Model');

    await userEvent.type(screen.getByLabelText('ticket_text'), 'test input');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('Playground run failed.')).toBeInTheDocument();
  });
});
