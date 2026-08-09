import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '../page';
import { AuthService } from '@/lib/auth';
import { ApiClient } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { AuthContext } from '@/lib/auth-context';

vi.mock('@/lib/auth', () => ({
  AuthService: {
    getCurrentUser: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    getLLMConnection: vi.fn(),
    updateLLMConnection: vi.fn(),
    deleteLLMConnection: vi.fn(),
    testLLMConnection: vi.fn(),
    logoutEverywhere: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  ApiClient: {
    getPromptsConfig: vi.fn(),
    deleteAccount: vi.fn(),
    exportPrompts: vi.fn(),
  },
}));

const logout = vi.fn();

function renderSettings() {
  return render(
    <AuthContext.Provider value={{ currentUser: 'testuser', logout }}>
      <SettingsPage />
    </AuthContext.Provider>
  );
}

function user(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    username: 'testuser',
    email: 'testuser@example.com',
    created_at: '2026-07-01T00:00:00Z',
    notify_run_failure: false,
    notify_weekly_summary: false,
    default_library_view: null,
    default_eval_method: null,
    auto_run_eval_on_update: false,
    notify_eval_complete: false,
    notify_eval_regression: false,
    ...overrides,
  };
}

function connection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    configured: true,
    provider: 'openai',
    provider_label: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    has_api_key: true,
    api_key_hint: 'sk-…0000',
    providers: [
      {
        handle: 'openai',
        label: 'OpenAI',
        default_base_url: 'https://api.openai.com/v1',
        requires_api_key: true,
        suggested_models: ['gpt-4o-mini', 'gpt-4o'],
        docs_url: 'https://platform.openai.com/api-keys',
      },
      {
        handle: 'ollama',
        label: 'Ollama (self-hosted)',
        default_base_url: 'http://localhost:11434/v1',
        requires_api_key: false,
        suggested_models: [],
        docs_url: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  logout.mockClear();
  vi.mocked(AuthService.getCurrentUser).mockResolvedValue(user());
  vi.mocked(AuthService.getLLMConnection).mockResolvedValue(connection());
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: true,
    provider: 'openai',
    provider_label: 'OpenAI',
    model: 'gpt-4o-mini',
    available_models: ['gpt-4o-mini', 'gpt-4o'],
    budget_exhausted: false,
    global_budget_remaining_usd: null,
  });
});

describe('SettingsPage', () => {
  it('renders all section anchors in the rail', async () => {
    renderSettings();
    const rail = screen.getByRole('navigation', { name: 'Settings sections' });
    await within(rail).findByRole('link', { name: 'Profile' });
    expect(screen.getByRole('link', { name: 'Preferences' })).toHaveAttribute(
      'href',
      '#s-preferences'
    );
    expect(screen.getByRole('link', { name: 'Danger zone' })).toHaveAttribute('href', '#s-danger');
  });

  it('renders the six rail glyphs at 18px and marks the active location', async () => {
    renderSettings();
    const rail = screen.getByRole('navigation', { name: 'Settings sections' });
    const expectedIcons = [
      ['Profile', 'lucide-user'],
      ['Preferences', 'lucide-sliders-horizontal'],
      ['Notifications', 'lucide-bell'],
      ['API access', 'lucide-key-round'],
      ['Data', 'lucide-database'],
      ['Danger zone', 'lucide-triangle-alert'],
    ] as const;

    for (const [label, iconClass] of expectedIcons) {
      const link = within(rail).getByRole('link', { name: label });
      const icon = link.querySelector('svg');
      expect(icon).toHaveClass(iconClass);
      expect(icon).toHaveAttribute('width', '18');
      expect(icon).toHaveAttribute('height', '18');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }

    expect(within(rail).getByRole('link', { name: 'Profile' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    await userEvent.click(within(rail).getByRole('link', { name: 'Preferences' }));
    expect(within(rail).getByRole('link', { name: 'Preferences' })).toHaveAttribute(
      'aria-current',
      'location',
    );
  });

  it('updates the active rail location as the Settings page scrolls', async () => {
    renderSettings();
    const positions: Record<string, number> = {
      's-profile': -500,
      's-preferences': -250,
      's-notifications': 40,
      's-api': 500,
      's-data': 800,
      's-danger': 1100,
    };

    for (const [id, top] of Object.entries(positions)) {
      vi.spyOn(document.getElementById(id)!, 'getBoundingClientRect').mockReturnValue({
        top,
      } as DOMRect);
    }

    fireEvent.scroll(window);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute(
        'aria-current',
        'location',
      );
    });
  });

  it('uses icons only for the three visual-outcome segmented controls', async () => {
    renderSettings();
    await screen.findByRole('radiogroup', { name: 'Default library view' });

    const expectedIcons = [
      ['Light', 'lucide-sun'],
      ['Dark', 'lucide-moon'],
      ['Comfortable', 'lucide-rows-2'],
      ['Compact', 'lucide-rows-3'],
      ['Grid', 'lucide-layout-grid'],
      ['List', 'lucide-list'],
    ] as const;
    for (const [label, iconClass] of expectedIcons) {
      const radio = screen.getByRole('radio', { name: label });
      const icon = radio.querySelector('svg');
      expect(icon).toHaveClass(iconClass);
      expect(icon).toHaveAttribute('width', '14');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }

    for (const label of ['Rule', 'Judge', 'Manual']) {
      expect(screen.getByRole('radio', { name: label }).querySelector('svg')).toBeNull();
    }
  });

  it('shows the connected provider in the API access section', async () => {
    renderSettings();
    expect(await screen.findByText(/Connected · OpenAI/)).toBeInTheDocument();
  });

  it('shows Not connected when the user has no provider configured', async () => {
    vi.mocked(AuthService.getLLMConnection).mockResolvedValue(
      connection({ configured: false, has_api_key: false, api_key_hint: null }),
    );
    renderSettings();

    expect(await screen.findByText('Not connected')).toBeInTheDocument();
  });

  it('toggles the run-failure notification preference', async () => {
    vi.mocked(AuthService.updateProfile).mockResolvedValue(user({ notify_run_failure: true }));
    renderSettings();
    await screen.findByRole('switch', { name: 'Run failures' });

    await userEvent.click(screen.getByRole('switch', { name: 'Run failures' }));

    await waitFor(() => {
      expect(AuthService.updateProfile).toHaveBeenCalledWith({ notify_run_failure: true });
    });
  });

  it('describes the weekly summary as sent by the scheduled job', async () => {
    renderSettings();
    expect(
      await screen.findByText(/sent weekly by the server's scheduled job/i)
    ).toBeInTheDocument();
  });

  it('edits the email address', async () => {
    vi.mocked(AuthService.updateProfile).mockResolvedValue(
      user({ email: 'new@example.com' })
    );
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit email' }));

    const input = screen.getByPlaceholderText('you@example.com');
    await userEvent.clear(input);
    await userEvent.type(input, 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(AuthService.updateProfile).toHaveBeenCalledWith({ email: 'new@example.com' });
    });
  });

  it('shows an inline error when saving an empty username instead of silently ignoring it', async () => {
    vi.mocked(AuthService.updateProfile).mockClear();
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit username' }));

    const input = screen.getByDisplayValue('testuser');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Username cannot be empty.');
    expect(AuthService.updateProfile).not.toHaveBeenCalled();
  });

  it('shows an inline error when saving a malformed email instead of silently ignoring it', async () => {
    vi.mocked(AuthService.updateProfile).mockClear();
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit email' }));

    const input = screen.getByPlaceholderText('you@example.com');
    await userEvent.clear(input);
    await userEvent.type(input, 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
    expect(AuthService.updateProfile).not.toHaveBeenCalled();
  });

  it('updates the default library view preference', async () => {
    vi.mocked(AuthService.updateProfile).mockResolvedValue(
      user({ default_library_view: 'list' })
    );
    renderSettings();
    await screen.findByRole('radiogroup', { name: 'Default library view' });

    await userEvent.click(screen.getByRole('radio', { name: 'List' }));

    await waitFor(() => {
      expect(AuthService.updateProfile).toHaveBeenCalledWith({ default_library_view: 'list' });
    });
  });

  it('shows inline progress and success while a preference autosaves', async () => {
    let resolveUpdate!: (value: ReturnType<typeof user>) => void;
    vi.mocked(AuthService.updateProfile).mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    renderSettings();
    await screen.findByRole('radiogroup', { name: 'Default library view' });

    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(screen.getByText('Saving preference')).toBeInTheDocument();
    expect(screen.getByText('Saving preference').previousElementSibling).toHaveClass(
      'lucide-loader-circle',
    );

    resolveUpdate(user({ default_library_view: 'list' }));

    expect(await screen.findByText('Preference saved')).toBeInTheDocument();
    expect(screen.getByText('Preference saved').previousElementSibling).toHaveClass('lucide-check');
  });

  it('updates the default eval scoring method preference', async () => {
    vi.mocked(AuthService.updateProfile).mockResolvedValue(
      user({ default_eval_method: 'judge' })
    );
    renderSettings();
    await screen.findByRole('radiogroup', { name: 'Default eval scoring method' });

    await userEvent.click(screen.getByRole('radio', { name: 'Judge' }));

    await waitFor(() => {
      expect(AuthService.updateProfile).toHaveBeenCalledWith({ default_eval_method: 'judge' });
    });
  });

  it('toggles auto-run evaluation on update', async () => {
    vi.mocked(AuthService.updateProfile).mockResolvedValue(
      user({ auto_run_eval_on_update: true })
    );
    renderSettings();
    await screen.findByRole('switch', { name: 'Auto-run evaluation on Update' });

    await userEvent.click(screen.getByRole('switch', { name: 'Auto-run evaluation on Update' }));

    await waitFor(() => {
      expect(AuthService.updateProfile).toHaveBeenCalledWith({ auto_run_eval_on_update: true });
    });
  });

  it('toggles the evaluation-complete notification preference', async () => {
    vi.mocked(AuthService.updateProfile).mockResolvedValue(
      user({ notify_eval_complete: true })
    );
    renderSettings();
    await screen.findByRole('switch', { name: 'Evaluation complete' });

    await userEvent.click(screen.getByRole('switch', { name: 'Evaluation complete' }));

    await waitFor(() => {
      expect(AuthService.updateProfile).toHaveBeenCalledWith({ notify_eval_complete: true });
    });
  });

  it('toggles the score-regression notification preference', async () => {
    vi.mocked(AuthService.updateProfile).mockResolvedValue(
      user({ notify_eval_regression: true })
    );
    renderSettings();
    await screen.findByRole('switch', { name: 'Score regression' });

    await userEvent.click(screen.getByRole('switch', { name: 'Score regression' }));

    await waitFor(() => {
      expect(AuthService.updateProfile).toHaveBeenCalledWith({ notify_eval_regression: true });
    });
  });

  it('triggers a download when Export is clicked', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    vi.mocked(ApiClient.exportPrompts).mockResolvedValue(blob);

    renderSettings();
    const exportButton = await screen.findByRole('button', { name: 'Export' });
    expect(exportButton.querySelector('svg')).toHaveClass('lucide-download');
    expect(exportButton.querySelector('svg')).toHaveAttribute('width', '16');
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(ApiClient.exportPrompts).toHaveBeenCalled();
      // Asserted at the download boundary rather than on URL.createObjectURL:
      // clicking a synthesised <a download> is unimplemented in jsdom and
      // produced an uncaught navigation error from a timer.
      expect(downloadBlob).toHaveBeenCalledWith(blob, expect.stringContaining('.json'));
    });
  });

  it('renders the danger section header with its 16px risk icon', async () => {
    renderSettings();

    const heading = await screen.findByRole('heading', { name: 'Danger zone' });
    const icon = heading.querySelector('svg');
    expect(icon).toHaveClass('lucide-triangle-alert');
    expect(icon).toHaveAttribute('width', '16');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('signs out every session and logs out locally', async () => {
    vi.mocked(AuthService.logoutEverywhere).mockResolvedValue(undefined);
    renderSettings();

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => {
      expect(AuthService.logoutEverywhere).toHaveBeenCalled();
      expect(logout).toHaveBeenCalled();
    });
  });

  it('reports a failed sign-out-everywhere and stays signed in', async () => {
    vi.mocked(AuthService.logoutEverywhere).mockRejectedValue(new Error('Server said no'));
    renderSettings();

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server said no');
    expect(logout).not.toHaveBeenCalled();
  });

  it('deletes the account after password confirmation and logs out', async () => {
    vi.mocked(ApiClient.deleteAccount).mockResolvedValue(undefined);
    renderSettings();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
    await userEvent.type(screen.getByLabelText('Confirm your password'), 'testpass123');
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    await waitFor(() => {
      expect(ApiClient.deleteAccount).toHaveBeenCalledWith('testpass123');
      expect(logout).toHaveBeenCalled();
    });
  });

  it('cannot delete without entering a password', async () => {
    // This suite does not reset mocks between tests, so the earlier successful
    // deletion would otherwise still be recorded on the spy.
    vi.mocked(ApiClient.deleteAccount).mockClear();
    renderSettings();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }));

    expect(screen.getByRole('button', { name: 'Yes, delete my account' })).toBeDisabled();
    expect(ApiClient.deleteAccount).not.toHaveBeenCalled();
  });

  it('keeps the confirmation open when the password is rejected', async () => {
    vi.mocked(ApiClient.deleteAccount).mockRejectedValue(new Error('Password is incorrect.'));
    renderSettings();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
    await userEvent.type(screen.getByLabelText('Confirm your password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect.');
    expect(logout).not.toHaveBeenCalled();
    // Still open, so a mistyped password can simply be corrected.
    expect(screen.getByLabelText('Confirm your password')).toBeInTheDocument();
  });
});
