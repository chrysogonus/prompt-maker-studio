/**
 * Type definitions for prompts and their sections
 */

export interface PromptField {
  name: string;
  content: string;
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
}

export interface PromptHistoryResponse {
  id: number;
  name: string | null;
  fields: PromptField[];
  generated_prompt: string;
  created_at: string;
  updated_at?: string | null;
  current_note?: string | null;
  folder?: string | null;
  is_favorite?: boolean;
  variable_metadata?: Record<string, VariableMetadataItem> | null;
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
