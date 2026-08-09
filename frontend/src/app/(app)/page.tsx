'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { ApiClient } from '@/lib/api';
import Button, { ButtonLink } from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import StatCard from '@/components/ui/StatCard';
import BarChart from '@/components/ui/BarChart';
import Card from '@/components/ui/Card';
import { DashboardStatsResponse } from '@/types/analytics';
import { PromptField } from '@/types/prompt';
import { SavedPrompt } from '@/types/saved-prompt';
import styles from './page.module.css';
import { pageTitle } from '@/lib/branding';

function toSavedPrompt(p: {
  id: number;
  name: string | null;
  fields: PromptField[];
  generated_prompt: string;
  created_at: string;
  updated_at?: string | null;
  folder?: string | null;
  run_count: number;
}): SavedPrompt {
  return {
    id: String(p.id),
    name: p.name ?? 'Untitled',
    promptId: p.id,
    fields: p.fields,
    generatedPrompt: p.generated_prompt,
    savedAt: p.created_at,
    updatedAt: p.updated_at ?? null,
    folder: p.folder ?? null,
    runCount: p.run_count,
  };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

export default function DashboardPage() {
  const { currentUser } = useAuth();
  const [stats, setStats] = useState<DashboardStatsResponse | null>(null);
  const [favorites, setFavorites] = useState<SavedPrompt[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [statsData, favoritesData] = await Promise.all([
          ApiClient.getDashboardStats(),
          ApiClient.getSavedPrompts({ favoriteOnly: true }),
        ]);
        setStats(statsData);
        setFavorites(favoritesData.map(toSavedPrompt));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      }
    };

    load();
  }, []);

  useEffect(() => {
    document.title = pageTitle('Dashboard');
    return () => {
      document.title = pageTitle();
    };
  }, []);

  const chartData = (stats?.request_volume_7d ?? []).map((d) => ({
    label: new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }),
    value: d.count,
  }));

  const maxTopPromptRuns = stats?.top_prompts[0]?.run_count ?? 1;

  return (
    <div className={styles.dashboard}>
      <PageHeader
        title={`Good to see you, ${currentUser}`}
        description="Jump back into your prompts, or start something new."
        actions={
          <ButtonLink href="/editor/new" variant="primary">
            + New prompt
          </ButtonLink>
        }
      />

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.statsRow}>
        <StatCard
          label="Runs this month"
          value={String(stats?.runs_this_month ?? 0)}
          hint={
            stats?.runs_change_pct != null
              ? `${stats.runs_change_pct >= 0 ? '↑' : '↓'} ${Math.abs(stats.runs_change_pct)}% vs last month`
              : undefined
          }
          hintTone="accent"
        />
        <StatCard
          label="Avg latency"
          value={stats?.avg_latency_ms != null ? `${(stats.avg_latency_ms / 1000).toFixed(2)}s` : '—'}
          hint="across all models"
        />
        <StatCard
          label="Success rate"
          value={stats?.success_rate_pct != null ? `${stats.success_rate_pct}%` : '—'}
          hint="Playground runs completed without error"
        />
        <StatCard
          label="Total AI spend"
          value={`$${(stats?.total_cost_usd ?? 0).toFixed(4)}`}
          hint="all AI features"
        />
        <StatCard
          label="Avg cost / run"
          value={
            stats?.avg_cost_per_run_usd != null
              ? `$${stats.avg_cost_per_run_usd.toFixed(6)}`
              : '—'
          }
          hint="all Playground runs"
        />
      </div>

      <div className={styles.midRow}>
        <Card className={styles.chartCard}>
          <h2 className={styles.cardTitle}>Requests, last 7 days</h2>
          <BarChart ariaLabel="Requests, last 7 days" data={chartData} />
        </Card>
        <Card className={styles.topCard}>
          <h2 className={styles.cardTitle}>Top prompts by usage</h2>
          {stats && stats.top_prompts.length > 0 ? (
            <div className={styles.topList}>
              {stats.top_prompts.map((p) => (
                <Link key={p.prompt_id} href={`/editor/${p.prompt_id}`} className={styles.topRow}>
                  <div className={styles.topRowHeader}>
                    <span className={styles.topRowName}>{p.name}</span>
                    <span className={styles.topRowCount}>{p.run_count} {p.run_count === 1 ? 'run' : 'runs'}</span>
                  </div>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${(p.run_count / maxTopPromptRuns) * 100}%` }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.emptyHint}>
              Run prompts in the Playground to see your top prompts here.
            </div>
          )}
        </Card>
      </div>

      <h2 className={styles.favoritesHeader}>Favorites</h2>
      {favorites.length === 0 ? (
        <div className={styles.emptyState}>
          <p>Star prompts in the Library to pin them here.</p>
          <Link href="/library">
            <Button variant="secondary">Browse your library</Button>
          </Link>
        </div>
      ) : (
        <div className={styles.favoritesGrid}>
          {favorites.map((p) => (
            <Link key={p.id} href={`/editor/${p.promptId}`} className={styles.favLink}>
              <Card className={styles.favCard}>
                <div className={styles.folderLabel}>{p.folder || ' '}</div>
                <div className={styles.favTitle}>{p.name}</div>
                <div className={styles.favDesc}>{p.generatedPrompt.slice(0, 140)}</div>
                <div className={styles.favFooter}>Edited {formatDate(p.updatedAt ?? p.savedAt)}</div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
