import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from '../page';
import { ApiClient } from '@/lib/api';
import { AuthContext } from '@/lib/auth-context';

vi.mock('@/lib/api', () => ({
  ApiClient: {
    getDashboardStats: vi.fn(),
    getSavedPrompts: vi.fn(),
  },
}));

function renderDashboard() {
  return render(
    <AuthContext.Provider value={{ currentUser: 'testuser', logout: vi.fn() }}>
      <DashboardPage />
    </AuthContext.Provider>
  );
}

const emptyStats = {
  runs_this_month: 0,
  runs_change_pct: null,
  avg_latency_ms: null,
  success_rate_pct: null,
  total_cost_usd: 0,
  avg_cost_per_run_usd: null,
  request_volume_7d: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-07-0${i + 1}`,
    count: 0,
  })),
  top_prompts: [],
};

beforeEach(() => {
  vi.mocked(ApiClient.getDashboardStats).mockResolvedValue(emptyStats);
  vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([]);
});

describe('DashboardPage', () => {
  it('greets the current user and shows real (not fabricated) zero stats when there is no data', async () => {
    renderDashboard();

    expect(await screen.findByText('Good to see you, testuser')).toBeInTheDocument();
    expect(screen.getByText('Runs this month')).toBeInTheDocument();
    expect(screen.getAllByText('0').length + screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows an empty-state prompt to browse the library when there are no favorites', async () => {
    renderDashboard();

    expect(await screen.findByText('Star prompts in the Library to pin them here.')).toBeInTheDocument();
  });

  it('renders real stat values and requests favorites with favoriteOnly', async () => {
    vi.mocked(ApiClient.getDashboardStats).mockResolvedValue({
      runs_this_month: 47,
      runs_change_pct: 12.5,
      avg_latency_ms: 1840,
      success_rate_pct: 98.6,
      total_cost_usd: 1.234567,
      avg_cost_per_run_usd: 0.012345,
      request_volume_7d: emptyStats.request_volume_7d,
      top_prompts: [{ prompt_id: 1, name: 'Support Triage', run_count: 20 }],
    });

    renderDashboard();

    expect(await screen.findByText('47')).toBeInTheDocument();
    expect(screen.getByText('1.84s')).toBeInTheDocument();
    expect(screen.getByText('98.6%')).toBeInTheDocument();
    expect(screen.getByText('$1.2346')).toBeInTheDocument();
    expect(screen.getByText('$0.012345')).toBeInTheDocument();
    expect(screen.getByText('Support Triage')).toBeInTheDocument();
    expect(ApiClient.getSavedPrompts).toHaveBeenCalledWith({ favoriteOnly: true });
  });

  it('uses a real editor link for a favorite card', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([
      {
        id: 5,
        name: 'Favorite Prompt',
        fields: [{ name: 'goal', content: 'x' }],
        generated_prompt: '<GOAL>x</GOAL>',
        created_at: '2026-07-01T00:00:00Z',
        run_count: 0,
      },
    ]);

    renderDashboard();
    const card = await screen.findByText('Favorite Prompt');
    expect(card.closest('a')).toHaveAttribute('href', '/editor/5');
  });
});
