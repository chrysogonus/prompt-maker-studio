export type EvalMethod = 'rule' | 'judge' | 'manual';

export interface EvalCaseInput {
  method: EvalMethod;
  name: string;
  criteria: string;
  variables: Record<string, string>;
  intentionally_empty: boolean;
}

export interface EvalCase extends Omit<EvalCaseInput, 'name' | 'criteria'> {
  id: number;
  prompt_id: number;
  name: string | null;
  criteria: string | null;
  position: number;
  created_at: string;
}

export interface EvalProposal {
  method: EvalMethod;
  name: string;
  criteria: string | null;
  variables: Record<string, string>;
  rationale: string;
}

export interface EvalResult {
  id: number;
  eval_case_id: number | null;
  method: EvalMethod;
  label: string;
  rationale: string | null;
  score: number | null;
  is_pending: boolean;
  output_text: string | null;
  criteria: string | null;
  variables: Record<string, string> | null;
  judge_model: string | null;
}

export interface EvalRun {
  id: number;
  prompt_id: number;
  prompt_version_number: number;
  score: number | null;
  created_at: string;
  results: EvalResult[];
  model: string;
  total_latency_ms: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost_usd: number;
}
