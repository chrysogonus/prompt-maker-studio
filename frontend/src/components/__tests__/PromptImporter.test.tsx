import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromptImporter from '../PromptImporter';
import { ApiClient } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  ApiClient: {
    getPromptsConfig: vi.fn(),
    parsePromptText: vi.fn(),
  },
}));

const collapseToggle = () => screen.getByRole('button', { name: /(collapse|expand) ai import/i });
const submitButton = () => screen.getByRole('button', { name: /parse & import/i });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({ provider_connected: true, provider: 'openai', provider_label: 'OpenAI', model: 'gpt-4o-mini', available_models: [], budget_exhausted: false, global_budget_remaining_usd: null });
});

describe('PromptImporter component', () => {
  it('starts expanded by default (no localStorage entry)', async () => {
    render(<PromptImporter onImport={vi.fn()} />);

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    await waitFor(() => expect(ApiClient.getPromptsConfig).toHaveBeenCalled());
  });

  it('collapses when the toggle button is clicked, and remembers it', async () => {
    render(<PromptImporter onImport={vi.fn()} />);

    await userEvent.click(collapseToggle());

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(localStorage.getItem('prompt-importer:open')).toBe('false');
  });

  it('expands again when the toggle button is clicked a second time', async () => {
    render(<PromptImporter onImport={vi.fn()} />);

    await userEvent.click(collapseToggle());
    await userEvent.click(collapseToggle());

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('starts collapsed when localStorage has open=false', async () => {
    localStorage.setItem('prompt-importer:open', 'false');
    render(<PromptImporter onImport={vi.fn()} />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // The component fetches its config on mount. Without awaiting that, the
    // resulting state update lands after the test ends and React reports an
    // unwrapped-act warning attributed to nothing in particular.
    await waitFor(() => expect(ApiClient.getPromptsConfig).toHaveBeenCalled());
  });

  it('disables the submit button and shows a notice when AI import is unavailable', async () => {
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({ provider_connected: false, provider: null, provider_label: null, model: null, available_models: [], budget_exhausted: false, global_budget_remaining_usd: null });

    render(<PromptImporter onImport={vi.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), 'Some text');

    await waitFor(() => {
      expect(submitButton()).toBeDisabled();
    });
    expect(screen.getByText(/needs an AI provider/i)).toBeInTheDocument();
  });

  it('leaves the submit button enabled when AI import is available', async () => {
    render(<PromptImporter onImport={vi.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), 'Some text');

    await waitFor(() => {
      expect(submitButton()).not.toBeDisabled();
    });
    expect(screen.queryByText(/needs an AI provider/i)).not.toBeInTheDocument();
  });

  it('fails open (leaves the importer enabled) if the capability check itself rejects', async () => {
    vi.mocked(ApiClient.getPromptsConfig).mockRejectedValue(new Error('network error'));

    render(<PromptImporter onImport={vi.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), 'Some text');

    await waitFor(() => {
      expect(submitButton()).not.toBeDisabled();
    });
  });

  it('imports parsed fields, then collapses to a result bar that keeps the text', async () => {
    const onImport = vi.fn();
    vi.mocked(ApiClient.parsePromptText).mockResolvedValue({
      fields: [
        { name: 'goal', content: 'Write a story' },
        { name: 'tone', content: 'Gritty' },
      ],
    });

    render(<PromptImporter onImport={onImport} />);

    await userEvent.type(screen.getByRole('textbox'), 'A gritty story about a knight');
    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith([
        { name: 'goal', content: 'Write a story' },
        { name: 'tone', content: 'Gritty' },
      ])
    );
    expect(ApiClient.parsePromptText).toHaveBeenCalledWith({ text: 'A gritty story about a knight' });
    expect(await screen.findByText(/imported 2 fields/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // Collapsing after an import is situational, not a remembered preference.
    expect(localStorage.getItem('prompt-importer:open')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /edit text/i }));
    expect(screen.getByRole('textbox')).toHaveValue('A gritty story about a knight');
  });

  it('renders the error and stays open when parsing fails', async () => {
    const onImport = vi.fn();
    vi.mocked(ApiClient.parsePromptText).mockRejectedValue(new Error('Model unavailable'));

    render(<PromptImporter onImport={onImport} />);

    await userEvent.type(screen.getByRole('textbox'), 'Something');
    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Model unavailable');
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('submits on Ctrl+Enter', async () => {
    vi.mocked(ApiClient.parsePromptText).mockResolvedValue({ fields: [{ name: 'goal', content: 'x' }] });

    render(<PromptImporter onImport={vi.fn()} />);

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'A knight{Control>}{Enter}{/Control}');

    await waitFor(() => expect(ApiClient.parsePromptText).toHaveBeenCalled());
  });

  it('fills the textarea from an example chip', async () => {
    render(<PromptImporter onImport={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Story' }));

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('lone knight');
    // The chips are a blank-page cure only; they go away once there is text.
    expect(screen.queryByRole('button', { name: 'Story' })).not.toBeInTheDocument();
  });

  it('warns that importing replaces the fields the user already has', () => {
    render(<PromptImporter onImport={vi.fn()} existingFieldCount={3} />);

    expect(screen.getByText(/replaces your 3 current fields/i)).toBeInTheDocument();
  });

  it('offers Undo after an import and hands it back to the parent', async () => {
    const onUndo = vi.fn();
    vi.mocked(ApiClient.parsePromptText).mockResolvedValue({ fields: [{ name: 'goal', content: 'x' }] });

    render(<PromptImporter onImport={vi.fn()} onUndo={onUndo} />);

    await userEvent.type(screen.getByRole('textbox'), 'Something');
    await userEvent.click(submitButton());

    await userEvent.click(await screen.findByRole('button', { name: /undo/i }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/imported 1 field/i)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
