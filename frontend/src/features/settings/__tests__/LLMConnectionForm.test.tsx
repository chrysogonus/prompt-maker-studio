import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LLMConnectionForm from '../LLMConnectionForm';
import { AuthService } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({
  AuthService: {
    getLLMConnection: vi.fn(),
    updateLLMConnection: vi.fn(),
    deleteLLMConnection: vi.fn(),
    testLLMConnection: vi.fn(),
    getLLMModels: vi.fn(),
  },
}));

const PROVIDERS = [
  {
    handle: 'openai',
    label: 'OpenAI',
    default_base_url: 'https://api.openai.com/v1',
    requires_api_key: true,
    suggested_models: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'],
    models: [
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', input_price_per_1m: 10, output_price_per_1m: 50 },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', input_price_per_1m: 2, output_price_per_1m: 10 },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', input_price_per_1m: null, output_price_per_1m: null },
    ],
    docs_url: 'https://platform.openai.com/api-keys',
  },
  {
    handle: 'anthropic',
    label: 'Anthropic',
    default_base_url: 'https://api.anthropic.com/v1/',
    requires_api_key: true,
    suggested_models: ['claude-sonnet-5-5'],
    models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input_price_per_1m: 2, output_price_per_1m: 10 }],
    docs_url: null,
  },
  {
    handle: 'ollama',
    label: 'Ollama (self-hosted)',
    default_base_url: 'http://localhost:11434/v1',
    requires_api_key: false,
    suggested_models: [],
    models: [],
    docs_url: null,
  },
];

function connection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    configured: true,
    provider: 'openai',
    provider_label: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-6.1-sol',
    has_api_key: true,
    api_key_hint: 'sk-…0000',
    providers: PROVIDERS,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(AuthService.getLLMConnection).mockResolvedValue(connection());
  vi.mocked(AuthService.getLLMModels).mockResolvedValue([]);
});

describe('LLMConnectionForm', () => {
  it('announces successful connection tests as a status', async () => {
    vi.mocked(AuthService.testLLMConnection).mockResolvedValue({ ok: true, message: 'Connection verified' });
    render(<LLMConnectionForm />);
    await userEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Connection verified');
  });

  it('groups non-text models separately and distinguishes configuration from a successful test', async () => {
    const user = userEvent.setup();
    vi.mocked(AuthService.getLLMConnection).mockResolvedValue(connection({ provider: 'ollama', model: 'gpt-4o-mini', base_url: 'http://localhost:11434/v1' }));
    vi.mocked(AuthService.getLLMModels).mockResolvedValue(['gpt-4o-mini', 'text-embedding-3-small', 'whisper-1', 'custom-local'].map((id) => ({
      id, input_price_per_1m: null, output_price_per_1m: null,
    })));
    render(<LLMConnectionForm />);
    expect(await screen.findByRole('option', { name: /text-embedding/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /whisper/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /custom-local/ })).toBeEnabled();
    expect(screen.getByText(/Model compatibility has not been tested/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Model'));
    await user.type(screen.getByLabelText('Model'), 'my-self-hosted-model');
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    expect(screen.getByText(/Save changes before testing/)).toBeInTheDocument();
  });
  it('populates the form from the saved connection', async () => {
    render(<LLMConnectionForm />);

    expect(await screen.findByLabelText('Provider')).toHaveValue('openai');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-6.1-sol');
    expect(screen.getByText(/Configured for OpenAI/)).toBeInTheDocument();
  });

  it('offers only curated choices with labels and prices, even when discovery fails', async () => {
    vi.mocked(AuthService.getLLMModels).mockRejectedValue(new Error('models unavailable'));
    render(<LLMConnectionForm />);

    const picker = await screen.findByRole('combobox', { name: 'Model' });
    expect(picker).toHaveValue('gpt-6.1-sol');
    expect(screen.getByRole('option', { name: 'GPT-6.1 Sol — $2.00/$10.00 per 1M tokens' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'GPT-6 Luna — pricing unknown' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Model' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Available models')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers hosted choices before credentials are saved and resets choices on provider switch', async () => {
    vi.mocked(AuthService.getLLMConnection).mockResolvedValue(connection({
      configured: false, provider: null, model: null, base_url: null, has_api_key: false,
    }));
    render(<LLMConnectionForm />);
    await userEvent.selectOptions(await screen.findByLabelText('Provider'), 'anthropic');
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('claude-sonnet-5-5');
    expect(screen.getByRole('option', { name: /Claude Sonnet 5.5/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /GPT-6/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'openai');
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('gpt-6-astra');
    expect(screen.queryByRole('option', { name: /Claude Sonnet/ })).not.toBeInTheDocument();
  });

  it('keeps a legacy connection testable but requires a current choice before saving', async () => {
    vi.mocked(AuthService.getLLMConnection).mockResolvedValue(connection({ model: 'gpt-4o-mini' }));
    vi.mocked(AuthService.updateLLMConnection).mockResolvedValue(connection());
    render(<LLMConnectionForm />);
    expect(await screen.findByText(/Previously configured model/)).toHaveTextContent('gpt-4o-mini');
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('');
    expect(screen.queryByRole('option', { name: /gpt-4o-mini/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save connection' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'gpt-6.1-sol');
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() => expect(AuthService.updateLLMConnection).toHaveBeenCalledWith({
      provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-6.1-sol',
    }));
  });

  it('keeps manual model entry when local discovery fails', async () => {
    vi.mocked(AuthService.getLLMConnection).mockResolvedValue(connection({ provider: 'ollama', model: 'local-model', base_url: 'http://localhost:11434/v1' }));
    vi.mocked(AuthService.getLLMModels).mockRejectedValue(new Error('models unavailable'));
    render(<LLMConnectionForm />);
    const input = await screen.findByRole('textbox', { name: 'Model' });
    await userEvent.clear(input);
    await userEvent.type(input, 'my-custom-model');
    expect(input).toHaveValue('my-custom-model');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never prefills the API key, only a masked hint', async () => {
    render(<LLMConnectionForm />);

    const keyField = await screen.findByLabelText('API key');
    expect(keyField).toHaveValue('');
    expect(keyField).toHaveAttribute('type', 'password');
    expect(keyField).toHaveAttribute('placeholder', expect.stringContaining('sk-…0000'));
  });

  it('reveals and hides a newly entered API key with an accessible icon-only action', async () => {
    render(<LLMConnectionForm />);

    const keyField = await screen.findByLabelText('API key');
    await userEvent.type(keyField, 'sk-new-key');
    const revealButton = screen.getByRole('button', { name: 'Reveal API key' });
    expect(revealButton.querySelector('svg')).toHaveClass('lucide-eye');

    await userEvent.click(revealButton);

    expect(keyField).toHaveAttribute('type', 'text');
    const hideButton = screen.getByRole('button', { name: 'Hide API key' });
    expect(hideButton.querySelector('svg')).toHaveClass('lucide-eye-off');

    await userEvent.click(hideButton);
    expect(keyField).toHaveAttribute('type', 'password');
  });

  it('omits the key when saving with the field left blank, so the stored one survives', async () => {
    vi.mocked(AuthService.updateLLMConnection).mockResolvedValue(connection());
    render(<LLMConnectionForm />);
    await screen.findByLabelText('Provider');

    await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));

    await waitFor(() => {
      expect(AuthService.updateLLMConnection).toHaveBeenCalledWith({
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-6.1-sol',
      });
    });
  });

  it('refreshes local discovery after a successful save', async () => {
    const local = connection({ provider: 'ollama', model: 'local-model', base_url: 'http://localhost:11434/v1' });
    vi.mocked(AuthService.getLLMConnection).mockResolvedValue(local);
    vi.mocked(AuthService.updateLLMConnection).mockResolvedValue(local);
    render(<LLMConnectionForm />);
    await waitFor(() => expect(AuthService.getLLMModels).toHaveBeenCalledTimes(1));
    vi.mocked(AuthService.getLLMModels).mockResolvedValue([
      { id: 'local-after-save', input_price_per_1m: 0, output_price_per_1m: 0 },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(await screen.findByRole('option', { name: 'local-after-save — $0.00/$0.00 per 1M tokens' })).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toHaveValue('local-model');
  });

  it('fills in the default base URL and clears the key when the provider changes', async () => {
    render(<LLMConnectionForm />);
    const providerSelect = await screen.findByLabelText('Provider');

    await userEvent.selectOptions(providerSelect, 'ollama');

    expect(screen.getByLabelText('Base URL')).toHaveValue('http://localhost:11434/v1');
    expect(screen.getByLabelText('API key')).toHaveAttribute(
      'placeholder',
      'Paste your API key',
    );
  });

  it('warns that switching providers requires a new key', async () => {
    render(<LLMConnectionForm />);
    const providerSelect = await screen.findByLabelText('Provider');

    await userEvent.selectOptions(providerSelect, 'anthropic');

    expect(
      screen.getByText('Switching providers requires a new API key.'),
    ).toBeInTheDocument();
  });

  it('does not demand a key for a self-hosted provider', async () => {
    render(<LLMConnectionForm />);
    const providerSelect = await screen.findByLabelText('Provider');

    await userEvent.selectOptions(providerSelect, 'ollama');

    expect(screen.queryByText(/requires a new API key/)).not.toBeInTheDocument();
    expect(screen.getByText('API key (optional)')).toBeInTheDocument();
  });

  it('sends a newly entered key', async () => {
    vi.mocked(AuthService.updateLLMConnection).mockResolvedValue(connection());
    render(<LLMConnectionForm />);
    await screen.findByLabelText('Provider');

    await userEvent.type(screen.getByLabelText('API key'), 'sk-brand-new-key');
    await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));

    await waitFor(() => {
      expect(AuthService.updateLLMConnection).toHaveBeenCalledWith(
        expect.objectContaining({ api_key: 'sk-brand-new-key' }),
      );
    });
  });

  it('surfaces a save error inline', async () => {
    vi.mocked(AuthService.updateLLMConnection).mockRejectedValue(
      new Error('Anthropic requires an API key.'),
    );
    render(<LLMConnectionForm />);
    await screen.findByLabelText('Provider');

    await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Anthropic requires an API key.',
    );
  });

  it('reports a failed connection test as an error rather than success', async () => {
    vi.mocked(AuthService.testLLMConnection).mockResolvedValue({
      ok: false,
      message: 'OpenAI rejected your API key.',
    });
    render(<LLMConnectionForm />);
    await screen.findByLabelText('Provider');

    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'OpenAI rejected your API key.',
    );
  });

  it('reports a successful connection test', async () => {
    vi.mocked(AuthService.testLLMConnection).mockResolvedValue({
      ok: true,
      message: "Connected to OpenAI using 'gpt-4o-mini'.",
    });
    render(<LLMConnectionForm />);
    await screen.findByLabelText('Provider');

    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText(/Connected to OpenAI using/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Text-generation test passed');
  });

  it('disconnects and reports that the key was erased', async () => {
    vi.mocked(AuthService.deleteLLMConnection).mockResolvedValue(
      connection({
        configured: false,
        provider: null,
        provider_label: null,
        base_url: null,
        model: null,
        has_api_key: false,
        api_key_hint: null,
      }),
    );
    render(<LLMConnectionForm />);
    await screen.findByLabelText('Provider');

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect…' }));
    expect(screen.getByText(/AI features stop working until you connect again/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erase key and disconnect' }));

    expect(await screen.findByText(/API key has been erased/)).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('keeps the connection when Disconnect is cancelled', async () => {
    render(<LLMConnectionForm />);
    await screen.findByLabelText('Provider');

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(AuthService.deleteLLMConnection).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Disconnect…' })).toBeInTheDocument();
  });

  it('names the server default that replaces your own connection', async () => {
    vi.mocked(AuthService.getLLMConnection).mockResolvedValue(
      connection({ server_default: { provider_label: 'OpenAI', model: 'gpt-4.1-mini' } }),
    );
    render(<LLMConnectionForm />);
    expect(await screen.findByText(/Without it, this server’s shared connection \(OpenAI, gpt-4.1-mini\) would be used/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect…' }));
    expect(screen.getByText(/AI features will use this server’s shared connection \(OpenAI, gpt-4.1-mini\)/)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is connected yet', async () => {
    vi.mocked(AuthService.getLLMConnection).mockResolvedValue(
      connection({
        configured: false,
        provider: null,
        provider_label: null,
        base_url: null,
        model: null,
        has_api_key: false,
        api_key_hint: null,
      }),
    );
    render(<LLMConnectionForm />);

    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.getByLabelText('Provider')).toHaveValue('');
    // Nothing to test or disconnect before a provider is chosen.
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Disconnect…' })).not.toBeInTheDocument();
  });

  it('shows the server default, testable, when the user has no connection', async () => {
    vi.mocked(AuthService.getLLMConnection).mockResolvedValue(
      connection({
        configured: false,
        provider: null,
        provider_label: null,
        base_url: null,
        model: null,
        has_api_key: false,
        api_key_hint: null,
        server_default: { provider_label: 'vLLM (self-hosted)', model: 'served-model' },
      }),
    );
    render(<LLMConnectionForm />);

    expect(
      await screen.findByText(
        'Using this server’s default connection (vLLM (self-hosted), served-model)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled();
  });
});


it('shows optional Anthropic workspace and resets it when switching providers', async () => {
  const user = userEvent.setup();
  vi.mocked(AuthService.getLLMConnection).mockResolvedValue(connection({ provider: 'anthropic', base_url: 'https://api.anthropic.com/v1/', model: 'claude-sonnet-5-5', workspace_id: 'wrkspc_ABC123' }));
  vi.mocked(AuthService.updateLLMConnection).mockResolvedValue(connection({ provider: 'anthropic', model: 'claude-sonnet-5-5', workspace_id: 'wrkspc_NEXT' }));
  render(<LLMConnectionForm />);
  const workspace = await screen.findByLabelText('Anthropic workspace ID (optional)');
  expect(workspace).toHaveValue('wrkspc_ABC123');
  await user.clear(workspace);
  await user.type(workspace, 'wrkspc_NEXT');
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Save connection' }));
  await waitFor(() => expect(AuthService.updateLLMConnection).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: 'wrkspc_NEXT' })));
  await user.selectOptions(screen.getByLabelText('Provider'), 'openai');
  expect(screen.queryByLabelText('Anthropic workspace ID (optional)')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Provider'), 'anthropic');
  expect(screen.getByLabelText('Anthropic workspace ID (optional)')).toHaveValue('');
  expect(AuthService.testLLMConnection).not.toHaveBeenCalled();
});


it('rejects malformed workspace IDs and sends null to clear a saved workspace', async () => {
  const user = userEvent.setup();
  vi.mocked(AuthService.getLLMConnection).mockResolvedValue(connection({ provider: 'anthropic', base_url: 'https://api.anthropic.com/v1/', model: 'claude-sonnet-5-5', workspace_id: 'wrkspc_ABC123' }));
  vi.mocked(AuthService.updateLLMConnection).mockResolvedValue(connection({ provider: 'anthropic', base_url: 'https://api.anthropic.com/v1/', model: 'claude-sonnet-5-5', workspace_id: null }));
  vi.mocked(AuthService.deleteLLMConnection).mockResolvedValue(connection({ provider: null, base_url: null, model: null, configured: false, workspace_id: null }));
  render(<LLMConnectionForm />);
  const workspace = await screen.findByLabelText('Anthropic workspace ID (optional)');
  await user.clear(workspace);
  await user.type(workspace, 'invalid');
  await user.click(screen.getByRole('button', { name: 'Save connection' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('valid Anthropic workspace ID');
  expect(AuthService.updateLLMConnection).not.toHaveBeenCalled();
  await user.clear(workspace);
  await user.click(screen.getByRole('button', { name: 'Save connection' }));
  await waitFor(() => expect(AuthService.updateLLMConnection).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: null })));
  await user.click(screen.getByRole('button', { name: 'Disconnect…' }));
  await user.click(screen.getByRole('button', { name: 'Erase key and disconnect' }));
  await waitFor(() => expect(screen.queryByLabelText('Anthropic workspace ID (optional)')).not.toBeInTheDocument());
});
