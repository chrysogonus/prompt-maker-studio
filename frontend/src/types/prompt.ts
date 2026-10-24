/**
 * Type definitions for prompts and their sections
 */

export interface PromptField {
  name: string;
  content: string;
}

/** Results from one of the user's eval runs; the server loads their content. */
export interface RefineEvidence {
  prompt_id: number;
  run_id: number;
  result_ids: number[];
}

export interface RefineQAPair {
  question: string;
  answer: string;
}

export interface VariableMetadataItem {
  type: 'text' | 'number' | 'boolean' | 'list';
  description?: string | null;
  required?: boolean;
  example?: string | null;
  /** Values offered in Fill mode as a list; null or absent means free text. */
  options?: string[] | null;
}

export interface PromptHistoryResponse {
  id: number;
  name: string | null;
  fields: PromptField[];
  generated_prompt: string;
  created_at: string;
  updated_at?: string | null;
  content_updated_at?: string | null;
  current_note?: string | null;
  folder?: string | null;
  is_favorite?: boolean;
  variable_metadata?: Record<string, VariableMetadataItem> | null;
  known_good_version?: number | null;
  /** Library list only: whether evaluations tested the current text. */
  eval_status?: 'untested' | 'current' | 'stale' | null;
  eval_score?: number | null;
}

export interface ParseTextRequest {
  text: string;
  extract_variables?: boolean;
}

export interface ParseTextResponse {
  fields: PromptField[];
  variables?: ExtractedVariable[];
}

export interface PromptCreateRequest {
  name: string;
  fields: PromptField[];
  folder?: string | null;
  variable_metadata?: Record<string, VariableMetadataItem> | null;
}

/** The prompt's text is rendered from `fields` on the server, so it is never sent. */
export interface PromptUpdateRequest {
  name?: string | null;
  fields?: PromptField[] | null;
  folder?: string | null;
  is_favorite?: boolean | null;
  /** A version number to mark as known good; 0 clears the mark. */
  known_good_version?: number;
  variable_metadata?: Record<string, VariableMetadataItem> | null;
  note?: string | null;
  last_updated_at?: string;
}

export interface PromptsConfigResponse {
  // Whether the *calling user* has a usable connection: their own, or the
  // operator's server default. AI features key off this.
  provider_connected: boolean;
  provider: string | null;
  provider_label: string | null;
  model: string | null;
  // True when calls run on the operator-funded server default.
  uses_server_default?: boolean;
  available_models: string[];
  // Calling user's and shared monthly budget snapshot.
  budget_exhausted: boolean;
  global_budget_remaining_usd: number | null;
  user_budget_remaining_usd?: number | null;
  budget_scope?: 'shared' | 'user' | null;
  budget_resets_at?: string | null;
}

export interface PromptVersionResponse {
  id: number;
  version_number: number;
  note: string | null;
  legacy_note?: string | null;
  variable_metadata?: Record<string, VariableMetadataItem> | null;
  author: string | null;
  fields: PromptField[];
  generated_prompt: string;
  created_at: string;
}

export interface TryPromptResponse {
  output_text: string;
  provider: string;
  model: string;
}

export interface ExtractedVariable {
  name: string;
  value: string;
  description: string;
  source_text: string | null;
}
