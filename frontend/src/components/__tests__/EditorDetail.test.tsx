import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditorDetail from '../EditorDetail';
import { ApiClient, ApiError } from '@/lib/api';
import { AuthService } from '@/lib/auth';
import type { PromptHistoryResponse } from '@/types/prompt';

vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  ApiClient: {
    getPromptById: vi.fn(),
    getPromptVersions: vi.fn(),
    getPromptsConfig: vi.fn(),
    updatePrompt: vi.fn(),
    restorePromptVersion: vi.fn(),
    listEvalCases: vi.fn(),
    listEvalRuns: vi.fn(),
    createEvalRun: vi.fn(),
    getRefineQuestions: vi.fn(),
    getRefineDraft: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  AuthService: {
    getCurrentUser: vi.fn(),
  },
}));

// Supplied by `(app)/layout.tsx` in the real app; drafts are namespaced by it.
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ currentUser: 'alex', logout: vi.fn() }),
}));

let currentEditorParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn((url: string) => {
      const queryIndex = url.indexOf('?');
      const search = queryIndex !== -1 ? url.slice(queryIndex) : '';
      currentEditorParams = new URLSearchParams(search);
    }),
  }),
  useSearchParams: () => currentEditorParams,
  usePathname: () => '/editor/1',
}));

function prompt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Customer Support Triage',
    fields: [{ name: 'goal', content: 'triage' }],
    generated_prompt: '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-08T00:00:00Z',
    folder: 'Support',
    is_favorite: false,
    tags: ['gpt-4o'],
    run_count: 0,
    variable_metadata: null,
    ...overrides,
  };
}

beforeEach(() => {
  currentEditorParams = new URLSearchParams();
  vi.clearAllMocks();
  localStorage.clear();
  window.scrollTo = vi.fn();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt());
  vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([]);
  vi.mocked(ApiClient.getPromptsConfig).mockRejectedValue(new Error('no provider in test'));
  vi.mocked(ApiClient.listEvalCases).mockResolvedValue([]);
  vi.mocked(ApiClient.listEvalRuns).mockResolvedValue([]);
  vi.mocked(AuthService.getCurrentUser).mockRejectedValue(new Error('not authenticated in test'));
});

describe('EditorDetail', () => {
  it('loads and renders the prompt name and header actions', async () => {
    render(<EditorDetail promptId={1} />);

    await screen.findByLabelText('Prompt template');
    expect(screen.getAllByText('Customer Support Triage').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    const playgroundLink = screen.getByRole('link', { name: /Test in playground/ });
    expect(playgroundLink).toBeInTheDocument();
    expect(playgroundLink.querySelector('svg')).not.toBeInTheDocument();
  });

  it('renders a terminal not-found state instead of an infinite spinner', async () => {
    vi.mocked(ApiClient.getPromptById).mockRejectedValue(
      new Error('Prompt not found — it may have been deleted.'),
    );

    render(<EditorDetail promptId={99999} />);

    expect(await screen.findByRole('heading', { name: 'Prompt not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Library' })).toHaveAttribute('href', '/library');
    expect(screen.queryByText('Loading prompt...')).not.toBeInTheDocument();
    expect(ApiClient.getPromptVersions).not.toHaveBeenCalled();
  });

  it('restores an unsaved editor draft for the same server template', async () => {
    localStorage.setItem(
      'prompt-maker-studio:editor-draft:alex:1',
      JSON.stringify({
        baseTemplate: '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
        draft: '<GOAL>\nrestored draft {{ticket_text}}\n</GOAL>',
      }),
    );

    render(<EditorDetail promptId={1} />);

    expect(await screen.findByLabelText('Prompt template')).toHaveValue(
      '<GOAL>\nrestored draft {{ticket_text}}\n</GOAL>',
    );
    expect(screen.getByText('Unsaved draft — restored from this device')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('Prompt template')).toHaveValue(
      '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
    );
    expect(localStorage.getItem('prompt-maker-studio:editor-draft:alex:1')).toBeNull();
  });

  it('defaults to the Configuration tab', async () => {
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');
    expect(screen.getByRole('button', { name: 'Configuration' })).toHaveAttribute(
      'data-active',
      'true'
    );
  });

  it('switches to the Evaluate tab and fetches eval data', async () => {
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    await userEvent.click(screen.getByRole('button', { name: 'Evaluate' }));

    expect(await screen.findByText('Eval set')).toBeInTheDocument();
    await waitFor(() => expect(ApiClient.listEvalCases).toHaveBeenCalledWith(1));
  });

  it('switches to the Refine tab', async () => {
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    const refineTab = screen.getByRole('button', { name: 'Refine' });
    expect(refineTab.querySelectorAll('svg')).toHaveLength(1);
    expect(refineTab).not.toHaveTextContent(/\bAI\b/);
    await userEvent.click(refineTab);

    expect(await screen.findByText('Make this prompt sharper')).toBeInTheDocument();
  });

  it('labels the version snapshot created by an accepted refinement as the pre-refine state', async () => {
    vi.mocked(ApiClient.getRefineQuestions).mockResolvedValue({ questions: ['What tone?'] });
    vi.mocked(ApiClient.getRefineDraft).mockResolvedValue({ draft: 'A refined prompt' });
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(
      prompt({ generated_prompt: 'A refined prompt' }),
    );
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');
    await userEvent.click(screen.getByRole('button', { name: 'Refine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ask for clarification' }));
    await userEvent.type(await screen.findByPlaceholderText('Your answer…'), 'Formal');
    await userEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    await userEvent.click(
      await screen.findByRole('button', { name: /Accept & update prompt/ }),
    );

    await waitFor(() =>
      expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, {
        generated_prompt: 'A refined prompt',
        note: 'Before AI refinement',
        last_updated_at: '2026-07-08T00:00:00Z',
      }),
    );
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('switches back to Configuration and preserves unsaved template edits', async () => {
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    await userEvent.type(screen.getByLabelText('Prompt template'), ' more');
    await userEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
    await screen.findByText('Eval set');
    await userEvent.click(screen.getByRole('button', { name: 'Configuration' }));

    expect(screen.getByLabelText('Prompt template')).toHaveValue(
      '<GOAL>\ntriage {{ticket_text}}\n</GOAL> more'
    );
  });

  it('shows Update (not Save) for an already-named prompt, and PATCHes on click', async () => {
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, {
        generated_prompt: '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
        last_updated_at: '2026-07-08T00:00:00Z',
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Changes saved.');
  });

  it('keeps the Update label unchanged while showing the async loader', async () => {
    let resolveUpdate!: (value: PromptHistoryResponse) => void;
    vi.mocked(ApiClient.updatePrompt).mockReturnValue(
      new Promise<PromptHistoryResponse>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    render(<EditorDetail promptId={1} />);
    const updateButton = await screen.findByRole('button', { name: 'Update' });

    await userEvent.click(updateButton);

    expect(updateButton).toBeDisabled();
    expect(updateButton).toHaveAccessibleName('Update');
    expect(updateButton.querySelector('svg')).toHaveAttribute('stroke-width', '1.5');

    resolveUpdate(prompt() as PromptHistoryResponse);
    await waitFor(() => expect(updateButton).toBeEnabled());
  });

  it('shows Save (not Update) and opens the naming dialog for an unnamed prompt', async () => {
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt({ name: null }));
    render(<EditorDetail promptId={1} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Prompt Name')).toBeInTheDocument();
  });

  it('submits the Save Prompt dialog with Enter', async () => {
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt({ name: null }));
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt({ name: 'Named prompt' }));
    render(<EditorDetail promptId={1} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await userEvent.type(screen.getByLabelText('Prompt Name'), 'Named prompt{Enter}');

    await waitFor(() =>
      expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, {
        generated_prompt: '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
        name: 'Named prompt',
        last_updated_at: '2026-07-08T00:00:00Z',
      }),
    );
  });

  it('auto-runs an evaluation after Update when the user has opted in and has eval cases', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'testuser',
      created_at: '2026-07-01T00:00:00Z',
      auto_run_eval_on_update: true,
    });
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([
      { id: 1, prompt_id: 1, method: 'rule', criteria: 'x', variables: {}, position: 0, created_at: '2026-07-01T00:00:00Z' },
    ]);
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(ApiClient.createEvalRun).toHaveBeenCalledWith(1));
  });

  it('does not auto-run an evaluation when the user has not opted in', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'testuser',
      created_at: '2026-07-01T00:00:00Z',
      auto_run_eval_on_update: false,
    });
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalled());
    expect(ApiClient.createEvalRun).not.toHaveBeenCalled();
  });

  it('shows a run-evaluation nudge after Update when auto-run is off but cases exist', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'testuser',
      created_at: '2026-07-01T00:00:00Z',
      auto_run_eval_on_update: false,
    });
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([
      { id: 1, prompt_id: 1, method: 'rule', criteria: 'x', variables: {}, position: 0, created_at: '2026-07-01T00:00:00Z' },
    ]);
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(await screen.findByText(/run your eval set/)).toBeInTheDocument();
    expect(ApiClient.createEvalRun).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Run evaluation' }));

    await waitFor(() => expect(ApiClient.createEvalRun).toHaveBeenCalledWith(1));
    expect(screen.queryByText(/run your eval set/)).not.toBeInTheDocument();
  });

  it('does not show the nudge after Update when there are no eval cases', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'testuser',
      created_at: '2026-07-01T00:00:00Z',
      auto_run_eval_on_update: false,
    });
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalled());
    expect(screen.queryByText(/run your eval set/)).not.toBeInTheDocument();
  });

  it('sends the newest concurrency token when two variable edits fire back to back', async () => {
    // Two variables so the second edit is a genuinely different field.
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(
      prompt({ generated_prompt: '<GOAL>\n{{alpha}} {{beta}}\n</GOAL>' }),
    );
    let updateCount = 0;
    vi.mocked(ApiClient.updatePrompt).mockImplementation(async (_id, patch) => {
      updateCount += 1;
      return prompt({
        generated_prompt: '<GOAL>\n{{alpha}} {{beta}}\n</GOAL>',
        // Every write moves the server's timestamp forward, exactly as the
        // real PATCH handler does.
        updated_at: `2026-07-08T00:00:0${updateCount}Z`,
        variable_metadata: patch.variable_metadata ?? null,
      });
    });

    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    // Dispatched synchronously, inside a single render window — the second
    // handler must not reuse the token (or the metadata copy) the first one
    // already consumed. This is the shape of the reported repro: two type
    // changes within ~1s, where the second came back 409.
    fireEvent.change(screen.getByLabelText('alpha type'), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText('beta type'), { target: { value: 'boolean' } });

    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalledTimes(2));
    const [, firstPatch] = vi.mocked(ApiClient.updatePrompt).mock.calls[0];
    const [, secondPatch] = vi.mocked(ApiClient.updatePrompt).mock.calls[1];
    expect(firstPatch.last_updated_at).toBe('2026-07-08T00:00:00Z');
    expect(secondPatch.last_updated_at).toBe('2026-07-08T00:00:01Z');
    // The second patch also carries the first one's change forward rather than
    // overwriting it from a stale copy of variable_metadata.
    expect(secondPatch.variable_metadata).toEqual({
      alpha: { type: 'number', description: null },
      beta: { type: 'boolean', description: null },
    });
    expect(screen.queryByText(/modified by another session/)).not.toBeInTheDocument();
  });

  it('offers a working Reload on a genuine conflict and keeps the rejected draft', async () => {
    vi.mocked(ApiClient.updatePrompt).mockRejectedValue(
      new ApiError(
        'This prompt has been modified by another session. Please reload to merge or overwrite.',
        409,
      ),
    );
    render(<EditorDetail promptId={1} />);
    const template = await screen.findByLabelText('Prompt template');

    await userEvent.clear(template);
    await userEvent.type(template, 'my local edit');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    const banner = await screen.findByText(/modified by another session/);
    expect(banner).toBeInTheDocument();

    vi.mocked(ApiClient.getPromptById).mockResolvedValue(
      prompt({ generated_prompt: 'other session content', updated_at: '2026-07-09T00:00:00Z' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() =>
      expect(screen.queryByText(/modified by another session/)).not.toBeInTheDocument(),
    );
    // The rejected edit is still on screen, now flagged as unsaved against the
    // reloaded server state.
    expect(template).toHaveValue('my local edit');
    expect(screen.getByText(/Unsaved draft/)).toBeInTheDocument();
  });

  it('dismisses the nudge without running an evaluation', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'testuser',
      created_at: '2026-07-01T00:00:00Z',
      auto_run_eval_on_update: false,
    });
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([
      { id: 1, prompt_id: 1, method: 'rule', criteria: 'x', variables: {}, position: 0, created_at: '2026-07-01T00:00:00Z' },
    ]);
    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    await screen.findByText(/run your eval set/);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(/run your eval set/)).not.toBeInTheDocument();
    expect(ApiClient.createEvalRun).not.toHaveBeenCalled();
  });
  it('ignores a draft another account left under the same prompt id', async () => {
    localStorage.setItem(
      'prompt-maker-studio:editor-draft:someone-else:1',
      JSON.stringify({
        baseTemplate: '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
        draft: "the other account's unsaved work",
      }),
    );

    render(<EditorDetail promptId={1} />);

    expect(await screen.findByLabelText('Prompt template')).toHaveValue(
      '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
    );
    expect(screen.queryByText(/Unsaved draft/)).not.toBeInTheDocument();
  });

  it('warns about malformed XML on the Configuration tab without blocking Update', async () => {
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    render(<EditorDetail promptId={1} />);
    const template = await screen.findByLabelText('Prompt template');

    await userEvent.clear(template);
    await userEvent.type(template, '<QA_EMPTY></QA_EMPTY><QA_UNBALANCED>');

    const panel = await screen.findByLabelText('Preflight checks');
    expect(panel).toHaveTextContent('<QA_EMPTY> section is empty.');
    expect(panel).toHaveTextContent(/<QA_UNBALANCED> has 1 opening tag but 0 closing tags/);

    const update = screen.getByRole('button', { name: 'Update' });
    expect(update).toBeEnabled();
    await userEvent.click(update);
    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalled());
  });

  it('treats a non-numeric route id as a missing prompt rather than a fetch failure', async () => {
    render(<EditorDetail promptId={Number('00000000-0000-0000-0000-000000000000')} />);

    expect(await screen.findByRole('heading', { name: 'Prompt not found' })).toBeInTheDocument();
    expect(document.title).toBe('Prompt not found \u00b7 Prompt Maker Studio');
    expect(ApiClient.getPromptById).not.toHaveBeenCalled();
  });

  it('replaces the stale eval nudge instead of stacking a second banner', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'testuser',
      created_at: '2026-07-01T00:00:00Z',
      auto_run_eval_on_update: false,
    });
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    vi.mocked(ApiClient.listEvalCases).mockResolvedValue([
      { id: 1, prompt_id: 1, method: 'rule', criteria: 'x', variables: {}, position: 0, created_at: '2026-07-01T00:00:00Z' },
    ]);
    vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([
      {
        id: 5,
        version_number: 1,
        note: null,
        author: 'alex',
        fields: [],
        generated_prompt: 'older',
        created_at: '2026-07-01T00:00:00Z',
      },
    ]);
    vi.mocked(ApiClient.restorePromptVersion).mockResolvedValue(prompt());

    render(<EditorDetail promptId={1} />);
    await screen.findByLabelText('Prompt template');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    await screen.findByText(/run your eval set/);

    await userEvent.click(screen.getByRole('button', { name: /^v1\b/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));

    expect(await screen.findByText('Version restored.')).toBeInTheDocument();
    expect(screen.queryByText(/run your eval set/)).not.toBeInTheDocument();
  });
});
