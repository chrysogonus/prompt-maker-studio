/**
 * Type definitions for prompt generation
 */

export interface PromptField {
  name: string;
  content: string;
}

export interface PromptRequest {
  fields: PromptField[];
  name?: string | null;
}

export interface PromptResponse {
  id: number;
  name: string | null;
  generated_prompt: string;
  created_at: string;
  updated_at?: string | null;
}

export interface VariableMetadataItem {
  type: 'text' | 'number' | 'boolean' | 'list';
  description?: string | null;
}

export interface PromptHistoryResponse {
  id: number;
  name: string | null;
  fields: PromptField[];
  generated_prompt: string;
  created_at: string;
  updated_at?: string | null;
  folder?: string | null;
  is_favorite?: boolean;
  tags?: string[] | null;
  variable_metadata?: Record<string, VariableMetadataItem> | null;
  run_count: number;
}

export interface ParseTextRequest {
  text: string;
}

export interface ParseTextResponse {
  fields: PromptField[];
}

export interface PromptUpdateRequest {
  name?: string | null;
  fields?: PromptField[] | null;
  generated_prompt?: string | null;
  folder?: string | null;
  is_favorite?: boolean | null;
  tags?: string[] | null;
  variable_metadata?: Record<string, VariableMetadataItem> | null;
  note?: string | null;
  last_updated_at?: string;
}

export interface PromptsConfigResponse {
  // Whether the *calling user* has a usable bring-your-own provider
  // connection. AI features key off this, not an operator-wide flag.
  provider_connected: boolean;
  provider: string | null;
  provider_label: string | null;
  model: string | null;
  available_models: string[];
  // Global-only budget snapshot — see backend BudgetService.global_status.
  budget_exhausted: boolean;
  global_budget_remaining_usd: number | null;
}

export interface PlaygroundRunRequest {
  model: string;
  variables: Record<string, string>;
}

export interface PlaygroundRunResponse {
  output_text: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  model: string;
}

export interface PlaygroundRunHistoryResponse {
  id: number;
  model: string;
  input_variables: Record<string, string> | null;
  output_text: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  status: 'success' | 'error';
  error_message: string | null;
  created_at: string;
}

export interface PromptVersionResponse {
  id: number;
  version_number: number;
  note: string | null;
  author: string | null;
  fields: PromptField[];
  generated_prompt: string;
  created_at: string;
}

// Evaluate tab types

export type EvalMethod = 'rule' | 'judge' | 'manual';

export interface EvalCase {
  id: number;
  prompt_id: number;
  method: EvalMethod;
  name?: string | null;
  criteria: string | null;
  variables: Record<string, string>;
  intentionally_empty?: boolean;
  position: number;
  created_at: string;
}

export interface EvalCaseCreateRequest {
  method: EvalMethod;
  name?: string | null;
  criteria?: string | null;
  variables?: Record<string, string>;
  intentionally_empty?: boolean;
}

export interface EvalCaseUpdateRequest {
  method?: EvalMethod;
  name?: string | null;
  criteria?: string | null;
  variables?: Record<string, string>;
  intentionally_empty?: boolean;
}

export interface EvalRunResult {
  id: number;
  eval_case_id: number | null;
  method: EvalMethod;
  label: string;
  rationale: string | null;
  score: number | null;
  is_pending: boolean;
  output_text: string | null;
  // Snapshot of the case's criteria/variables at run time, and the judge
  // model actually used (judge method only) — survives later case edits.
  criteria?: string | null;
  variables?: Record<string, string> | null;
  judge_model?: string | null;
}

export interface EvalRun {
  id: number;
  prompt_id: number;
  prompt_version_number: number;
  score: number | null;
  created_at: string;
  results: EvalRunResult[];
  // Reproducibility metadata: resolved execution model, and aggregated
  // cost/latency/tokens across every case run + judge grading call.
  model: string;
  total_latency_ms: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost_usd: number;
}

export interface EvalRunRateRequest {
  stars: number;
}

export interface EvalCaseGenerateRequest {
  goal?: string | null;
}

export interface EvalCaseProposal {
  method: EvalMethod;
  /** Short label for the case; the rationale is shown separately on the card. */
  name: string;
  criteria: string | null;
  variables: Record<string, string>;
  rationale: string;
}

export interface EvalCaseGenerateResponse {
  proposals: EvalCaseProposal[];
}

// Refine tab types

export interface RefineQAPair {
  question: string;
  answer: string;
}

export interface RefineDraftRequest {
  qa_pairs: RefineQAPair[];
}

export interface RefineQuestionsResponse {
  questions: string[];
}

export interface RefineDraftResponse {
  draft: string;
}
