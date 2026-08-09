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
    suggested_models: ['gpt-4o-mini', 'gpt-4o'],
    docs_url: 'https://platform.openai.com/api-keys',
  },
  {
    handle: 'anthropic',
    label: 'Anthropic',
    default_base_url: 'https://api.anthropic.com/v1/',
    requires_api_key: true,
    suggested_models: ['claude-sonnet-5'],
    docs_url: null,
  },
  {
    handle: 'ollama',
    label: 'Ollama (self-hosted)',
    default_base_url: 'http://localhost:11434/v1',
    requires_api_key: false,
    suggested_models: [],
    docs_url: null,
  },
];

function connection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    configured: true,
    provider: 'openai',
    provider_label: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
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
  it('populates the form from the saved connection', async () => {
    render(<LLMConnectionForm />);

    expect(await screen.findByLabelText('Provider')).toHaveValue('openai');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-4o-mini');
    expect(screen.getByText(/Connected · OpenAI/)).toBeInTheDocument();
  });

  it('shows live models with pricing while keeping free-text entry available', async () => {
    vi.mocked(AuthService.getLLMModels).mockResolvedValue([
      {
        id: 'gpt-4o-mini',
        input_price_per_1m: 0.15,
        output_price_per_1m: 0.6,
      },
      {
        id: 'gpt-future',
        input_price_per_1m: null,
        output_price_per_1m: null,
      },
    ]);
    render(<LLMConnectionForm />);

    const catalogue = await screen.findByLabelText('Available models');
    expect(catalogue).toHaveValue('gpt-4o-mini');
    expect(
      screen.getByRole('option', {
        name: 'gpt-4o-mini — $0.15/$0.60 per 1M tokens',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'gpt-future — pricing unknown' }),
    ).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Model'));
    await userEvent.type(screen.getByLabelText('Model'), 'my-custom-model');
    expect(screen.getByLabelText('Model')).toHaveValue('my-custom-model');
    expect(catalogue).toHaveValue('');
  });

  it('keeps the original input and datalist when the live catalogue fails', async () => {
    vi.mocked(AuthService.getLLMModels).mockRejectedValue(new Error('models unavailable'));
    render(<LLMConnectionForm />);

    const modelInput = await screen.findByLabelText('Model');
    await waitFor(() => expect(AuthService.getLLMModels).toHaveBeenCalled());
    expect(screen.queryByLabelText('Available models')).not.toBeInTheDocument();
    expect(modelInput).toHaveAttribute('list', 'llm-model-suggestions');
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
        model: 'gpt-4o-mini',
      });
    });
  });

  it('refreshes the live catalogue after a successful save', async () => {
    vi.mocked(AuthService.updateLLMConnection).mockResolvedValue(connection());
    render(<LLMConnectionForm />);
    await waitFor(() => expect(AuthService.getLLMModels).toHaveBeenCalledTimes(1));
    vi.mocked(AuthService.getLLMModels).mockResolvedValue([
      {
        id: 'gpt-after-save',
        input_price_per_1m: 1,
        output_price_per_1m: 2,
      },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));

    expect(await screen.findByLabelText('Available models')).toHaveValue('');
    expect(
      screen.getByRole('option', {
        name: 'gpt-after-save — $1.00/$2.00 per 1M tokens',
      }),
    ).toBeInTheDocument();
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
    await waitFor(() => expect(AuthService.getLLMModels).toHaveBeenCalledTimes(2));
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

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByText(/API key has been erased/)).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });
});
