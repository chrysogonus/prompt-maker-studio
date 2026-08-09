/**
 * Type definitions for Dashboard usage analytics
 */

export interface DailyRequestCount {
  date: string;
  count: number;
}

export interface TopPromptUsage {
  prompt_id: number;
  name: string;
  run_count: number;
}

export interface DashboardStatsResponse {
  runs_this_month: number;
  runs_change_pct: number | null;
  avg_latency_ms: number | null;
  success_rate_pct: number | null;
  total_cost_usd: number;
  avg_cost_per_run_usd: number | null;
  request_volume_7d: DailyRequestCount[];
  top_prompts: TopPromptUsage[];
}
