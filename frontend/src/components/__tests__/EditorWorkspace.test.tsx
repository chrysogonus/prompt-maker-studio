import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditorWorkspace from '../EditorWorkspace';
import { ApiClient } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  ApiClient: {
    generatePrompt: vi.fn(),
    updatePrompt: vi.fn(),
    getPromptsConfig: vi.fn(),
    parsePromptText: vi.fn(),
  },
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

/** Mirrors PromptGeneratorService.generate: `<NAME>\ncontent\n</NAME>` blocks. */
function generatedFrom(fields: { name: string; content: string }[]): string {
  return fields
    .map((f) => `<${f.name.toUpperCase()}>\n${f.content}\n</${f.name.toUpperCase()}>`)
    .join('\n\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  let nextId = 100;
  vi.mocked(ApiClient.generatePrompt).mockImplementation(async ({ fields }) => ({
    id: nextId++,
    name: null,
    fields,
    generated_prompt: generatedFrom(fields),
    created_at: '2026-07-01T00:00:00Z',
  }));
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: false,
    provider: 'openai',
    provider_label: 'OpenAI',
    model: 'gpt-4o-mini',
    available_models: [],
    budget_exhausted: false,
    global_budget_remaining_usd: null,
  });
});

async function fillField(index: number, name: string, content: string) {
  const nameInputs = screen.getAllByPlaceholderText(/field name/i);
  const contentInputs = screen.getAllByPlaceholderText(/enter content for this field/i);
  await userEvent.clear(nameInputs[index]);
  await userEvent.type(nameInputs[index], name);
  await userEvent.clear(contentInputs[index]);
  await userEvent.type(contentInputs[index], content);
}

describe('EditorWorkspace save freshness', () => {
  it('persists the current field state, not a preview generated before the last edit', async () => {
    vi.mocked(ApiClient.updatePrompt).mockImplementation(async (id, patch) => ({
      id,
      name: patch.name ?? null,
      fields: patch.fields ?? [],
      generated_prompt: patch.generated_prompt ?? '',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      run_count: 0,
      variable_metadata: null,
    }));

    render(<EditorWorkspace currentUser="tester" />);

    await fillField(0, 'qa_first', 'first');
    await userEvent.click(screen.getByRole('button', { name: /\+ Add Field/i }));
    await fillField(1, 'qa_second', 'second');
    await userEvent.click(screen.getByRole('button', { name: /generate prompt/i }));

    await waitFor(() => expect(screen.getAllByText(/QA_SECOND/).length).toBeGreaterThan(0));

    // Rename the second field and do NOT regenerate — the preview on screen is
    // now stale, and saving it would silently discard the rename.
    const nameInputs = screen.getAllByPlaceholderText(/field name/i);
    await userEvent.clear(nameInputs[1]);
    await userEvent.type(nameInputs[1], 'qa_renamed');

    expect(screen.getByText(/Fields changed since this was generated/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await userEvent.type(screen.getByLabelText('Prompt Name'), 'Fresh save{Enter}');

    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalled());
    const [, patch] = vi.mocked(ApiClient.updatePrompt).mock.calls[0];
    expect(patch.generated_prompt).toContain('<QA_RENAMED>');
    expect(patch.generated_prompt).not.toContain('<QA_SECOND>');
  });

  it('does not regenerate when the preview already matches the fields', async () => {
    vi.mocked(ApiClient.updatePrompt).mockImplementation(async (id, patch) => ({
      id,
      name: patch.name ?? null,
      fields: patch.fields ?? [],
      generated_prompt: patch.generated_prompt ?? '',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      run_count: 0,
      variable_metadata: null,
    }));

    render(<EditorWorkspace currentUser="tester" />);

    await fillField(0, 'goal', 'unchanged');
    await userEvent.click(screen.getByRole('button', { name: /generate prompt/i }));
    await waitFor(() => expect(screen.getAllByText(/GOAL/).length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await userEvent.type(screen.getByLabelText('Prompt Name'), 'Same content{Enter}');

    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalled());
    expect(ApiClient.generatePrompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Fields changed since this was generated/)).not.toBeInTheDocument();
  });
});

describe('EditorWorkspace AI import', () => {
  beforeEach(() => {
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: true,
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-4o-mini',
      available_models: [],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    vi.mocked(ApiClient.parsePromptText).mockResolvedValue({
      fields: [{ name: 'imported', content: 'from ai' }],
    });
  });

  it('restores the fields an import replaced when the user undoes it', async () => {
    render(<EditorWorkspace currentUser="tester" />);

    await fillField(0, 'handwritten', 'my own words');
    await userEvent.click(screen.getByRole('button', { name: /generate prompt/i }));
    await waitFor(() => expect(screen.getAllByText(/HANDWRITTEN/).length).toBeGreaterThan(0));

    await userEvent.type(screen.getByLabelText('Describe your prompt'), 'a prompt about knights');
    await userEvent.click(screen.getByRole('button', { name: /parse & import/i }));

    await waitFor(() =>
      expect(screen.getAllByPlaceholderText(/field name/i)[0]).toHaveValue('imported')
    );
    // The import wipes the preview it no longer describes.
    expect(screen.queryByText(/HANDWRITTEN/)).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /undo/i }));

    expect(screen.getAllByPlaceholderText(/field name/i)[0]).toHaveValue('handwritten');
    expect(screen.getAllByPlaceholderText(/enter content for this field/i)[0]).toHaveValue(
      'my own words'
    );
    expect(screen.getAllByText(/HANDWRITTEN/).length).toBeGreaterThan(0);
  });
});
