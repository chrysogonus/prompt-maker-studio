import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PromptRefiner, { refinerInputKey } from '../PromptRefiner';
import PromptLinter from '../PromptLinter';
import { ApiClient, ApiError } from '@/lib/api';
import { openInApp } from '@/lib/openInApp';

vi.mock('@/lib/openInApp', () => ({ openInApp: vi.fn() }));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  ApiClient: { getPublicRefineStatus: vi.fn(), getPublicRefineQuestions: vi.fn(), createPublicRefineDraft: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(ApiClient.getPublicRefineStatus).mockResolvedValue({ available: true, max_chars: 8000 });
});

async function ready() {
  render(<PromptRefiner />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Improve now' })).toBeEnabled());
}

describe('PromptRefiner', () => {
  it('says when the server does not offer free refinement', async () => {
    vi.mocked(ApiClient.getPublicRefineStatus).mockResolvedValue({ available: false, max_chars: 0 });
    render(<PromptRefiner />);
    expect(await screen.findByRole('status')).toHaveTextContent('The free refiner is not offered on this server.');
    expect(screen.queryByRole('button', { name: 'Improve now' })).not.toBeInTheDocument();
  });

  it('shows no controls until it knows the server offers refinement', () => {
    vi.mocked(ApiClient.getPublicRefineStatus).mockReturnValue(new Promise(() => {}));
    render(<PromptRefiner />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking whether the free refiner is available…');
    expect(screen.queryByRole('button', { name: 'Improve now' })).not.toBeInTheDocument();
  });

  it('offers a retry when availability cannot be checked', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPublicRefineStatus).mockRejectedValueOnce(new Error('offline'));
    render(<PromptRefiner />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check whether free refinement is available.');
    expect(screen.getByRole('button', { name: 'Improve now' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Improve now' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('improves a prompt straight away and shows, copies and saves the result', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    vi.mocked(ApiClient.createPublicRefineDraft).mockResolvedValue({ text: 'Write a five-bullet summary of {{notes}} for my team.' });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Improve now' }));
    expect(ApiClient.createPublicRefineDraft).toHaveBeenCalledWith('Write a summary of {{notes}} for my team.', '', []);
    const changes = await screen.findByLabelText('Changes from your prompt');
    expect([...changes.querySelectorAll('ins')].map((node) => node.textContent).join('')).toContain('five-bullet');
    await user.click(screen.getByRole('button', { name: 'Copy refined prompt' }));
    expect(writeText).toHaveBeenCalledWith('Write a five-bullet summary of {{notes}} for my team.');
    await user.click(screen.getByRole('button', { name: 'Save to my library' }));
    expect(openInApp).toHaveBeenCalledWith({ fields: [{ name: 'Task', content: 'Write a five-bullet summary of {{notes}} for my team.' }] });
  });

  it('asks questions and sends only the answered ones', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPublicRefineQuestions).mockResolvedValue({ questions: ['Who reads it?', 'How long?'] });
    vi.mocked(ApiClient.createPublicRefineDraft).mockResolvedValue({ text: 'Refined.' });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Ask me questions first' }));
    await user.type(await screen.findByRole('textbox', { name: 'How long?' }), 'Five bullets');
    await user.click(screen.getByRole('button', { name: 'Refine with my answers' }));
    expect(ApiClient.createPublicRefineDraft).toHaveBeenCalledWith(expect.any(String), '', [{ question: 'How long?', answer: 'Five bullets' }]);
    await screen.findByLabelText('Changes from your prompt');
    await user.click(screen.getByRole('button', { name: 'Keep refining' }));
    expect(screen.getByRole('textbox', { name: 'Your prompt' })).toHaveValue('Refined.');
  });

  it('shows the server’s reason when a limit is reached', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.createPublicRefineDraft).mockRejectedValue(new ApiError('The free refiner has reached today\'s limit.', 429));
    await ready();
    await user.click(screen.getByRole('button', { name: 'Improve now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("today's limit");
  });

  it('blocks prompts over the limit before sending them', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPublicRefineStatus).mockResolvedValue({ available: true, max_chars: 10 });
    render(<PromptRefiner />);
    await screen.findByText('Shorten it to 10 characters.');
    await user.clear(screen.getByRole('textbox', { name: 'Your prompt' }));
    await user.type(screen.getByRole('textbox', { name: 'Your prompt' }), 'x'.repeat(11));
    expect(screen.getByText('Shorten it to 10 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Improve now' })).toBeDisabled();
  });

  it('starts from the prompt checker’s text once', async () => {
    sessionStorage.setItem(refinerInputKey(), 'From the checker');
    await ready();
    expect(screen.getByRole('textbox', { name: 'Your prompt' })).toHaveValue('From the checker');
    expect(sessionStorage.getItem(refinerInputKey())).toBeNull();
  });

  it('is handed text by the prompt checker', async () => {
    const user = userEvent.setup();
    render(<PromptLinter />);
    await user.click(screen.getByRole('link', { name: 'Refine this prompt' }));
    expect(sessionStorage.getItem(refinerInputKey())).toBe('Summarize this article about {{topic}}.');
  });
});
