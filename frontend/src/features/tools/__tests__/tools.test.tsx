import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TemplateFiller from '../TemplateFiller';
import PromptDiff from '../PromptDiff';
import PromptLinter from '../PromptLinter';
import TokenCounter, { estimateTokens } from '../TokenCounter';
import { ApiClient } from '@/lib/api';
import { openInApp } from '@/lib/openInApp';

vi.mock('@/lib/openInApp', () => ({ openInApp: vi.fn() }));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  ApiClient: { getPublicModelPrices: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe('TemplateFiller', () => {
  it('gives each variable one field, fills them in and copies the result', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<TemplateFiller initialText="Reply to {{name}} about {{issue}}, {{name}}." />);

    expect(screen.getAllByRole('textbox', { name: /name|issue/ })).toHaveLength(2);
    await user.type(screen.getByRole('textbox', { name: 'name' }), 'Dana');
    expect(screen.getByLabelText('Filled prompt')).toHaveTextContent('Reply to Dana about {{issue}}, Dana.');
    await user.click(screen.getByRole('button', { name: 'Copy prompt' }));
    expect(writeText).toHaveBeenCalledWith('Reply to Dana about {{issue}}, Dana.');
    expect(screen.getByRole('status')).toHaveTextContent('Copied with 1 unfilled placeholder.');
  });

  it('saves the template with its inputs to the library', async () => {
    const user = userEvent.setup();
    render(<TemplateFiller initialText="Explain {{topic}}." />);
    await user.type(screen.getByRole('textbox', { name: 'topic' }), 'tides');
    await user.click(screen.getByRole('button', { name: 'Save to my library' }));
    expect(openInApp).toHaveBeenCalledWith({ title: undefined, fields: [{ name: 'Task', content: 'Explain {{topic}}.' }], values: { topic: 'tides' }, hints: {} });
  });

  it('handles variable names an object would inherit, such as constructor', async () => {
    const user = userEvent.setup();
    render(<TemplateFiller initialText="Use {{constructor}}, {{toString}} and {{__proto__}}." />);
    expect(screen.getByLabelText('Filled prompt')).toHaveTextContent('Use {{constructor}}, {{toString}} and {{__proto__}}.');
    for (const name of ['constructor', 'toString', '__proto__']) expect(screen.getByRole('textbox', { name })).toHaveValue('');
    await user.type(screen.getByRole('textbox', { name: '__proto__' }), 'x');
    expect(screen.getByLabelText('Filled prompt')).toHaveTextContent('Use {{constructor}}, {{toString}} and x.');
  });

  it('fills fixed sections with hints and example inputs', async () => {
    const user = userEvent.setup();
    render(<TemplateFiller title="Trip" fields={[{ name: 'Task', content: 'Plan {{days}} days.' }]} hints={{ days: 'How long?' }} examples={{ days: '3' }} />);
    expect(screen.queryByLabelText('Prompt template')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'days' })).toHaveAttribute('placeholder', 'How long?');
    await user.click(screen.getByRole('button', { name: 'Use example inputs' }));
    expect(screen.getByLabelText('Filled prompt')).toHaveTextContent('Plan 3 days.');
  });
});

describe('PromptDiff', () => {
  it('marks added and removed words, and says when both match', async () => {
    const user = userEvent.setup();
    render(<PromptDiff />);
    const changes = screen.getByLabelText('Changes from before to after');
    expect([...changes.querySelectorAll('ins')].map((node) => node.textContent)).toContain('five');
    expect([...changes.querySelectorAll('del')].map((node) => node.textContent)).toContain('few');
    const before = screen.getByRole('textbox', { name: 'Before' });
    const after = screen.getByRole('textbox', { name: 'After' });
    await user.clear(before);
    await user.type(before, 'Same text.');
    await user.clear(after);
    await user.type(after, 'Same text.');
    expect(screen.getByRole('status')).toHaveTextContent('Both prompts are the same.');
    await user.click(screen.getByRole('button', { name: 'Save “After” to my library' }));
    expect(openInApp).toHaveBeenCalledWith({ fields: [{ name: 'Task', content: 'Same text.' }] });
  });
});

describe('PromptLinter', () => {
  it('lists findings and clears them for a complete prompt', async () => {
    const user = userEvent.setup();
    render(<PromptLinter />);
    expect(screen.getByRole('status')).toHaveTextContent('4 suggestions.');
    const box = screen.getByRole('textbox', { name: 'Your prompt' });
    await user.clear(box);
    await user.type(box, 'You are an editor. Summarize it in at most five bullets, for example "Decision: ship".');
    expect(screen.getByRole('status')).toHaveTextContent('No issues found.');
    await user.click(screen.getByRole('button', { name: 'Save to my library' }));
    expect(openInApp).toHaveBeenCalled();
  });
});

describe('TokenCounter', () => {
  it('estimates about four characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('counts the prompt and prices it per model', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPublicModelPrices).mockResolvedValue([
      { id: 'm', label: 'Model M', provider: 'openai', provider_label: 'OpenAI', input_price_per_1m: 2, output_price_per_1m: 8 },
      { id: 'u', label: null, provider: 'gemini', provider_label: 'Google Gemini', input_price_per_1m: null, output_price_per_1m: null },
    ]);
    render(<TokenCounter />);
    await user.type(screen.getByRole('textbox', { name: 'Your prompt' }), 'x'.repeat(40));
    expect(screen.getByText('≈ 10')).toBeInTheDocument();
    const row = await screen.findByRole('row', { name: /OpenAI · Model M/ });
    expect(row).toHaveTextContent('$2.00');
    expect(row).toHaveTextContent('$0.0000');
    expect(screen.getByRole('row', { name: /Google Gemini · u/ })).toHaveTextContent('—');
    await user.click(screen.getByRole('button', { name: 'Save to my library' }));
    expect(openInApp).toHaveBeenCalledWith({ fields: [{ name: 'Task', content: 'x'.repeat(40) }] });
  });

  it('keeps counting when prices fail to load', async () => {
    vi.mocked(ApiClient.getPublicModelPrices).mockRejectedValue(new Error('down'));
    render(<TokenCounter />);
    await waitFor(() => expect(screen.getByText(/Model prices could not be loaded/)).toBeInTheDocument());
  });
});
