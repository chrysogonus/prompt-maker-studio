/**
 * Authentication-related types
 */

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email: string;
}

/**
 * What a login or refresh returns. The token itself is absent by design — it
 * arrives as an httpOnly cookie, so no script on the page can read it.
 */
export interface TokenResponse {
  token_type: string;
  /** ISO-8601 instant at which this session stops being accepted. */
  expires_at: string;
}

export interface User {
  id: number;
  username: string;
  email?: string | null;
  created_at: string;
  notify_run_failure?: boolean;
  notify_weekly_summary?: boolean;
  default_library_view?: 'grid' | 'list' | null;
  default_eval_method?: 'rule' | 'judge' | 'manual' | null;
  auto_run_eval_on_update?: boolean;
  notify_eval_complete?: boolean;
  notify_eval_regression?: boolean;
}

export interface UserUpdate {
  email?: string | null;
  new_username?: string | null;
  notify_run_failure?: boolean | null;
  notify_weekly_summary?: boolean | null;
  default_library_view?: 'grid' | 'list' | null;
  default_eval_method?: 'rule' | 'judge' | 'manual' | null;
  auto_run_eval_on_update?: boolean | null;
  notify_eval_complete?: boolean | null;
  notify_eval_regression?: boolean | null;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

/** One provider offered by the backend registry, for the connection form. */
export interface LLMProviderOption {
  handle: string;
  label: string;
  default_base_url: string | null;
  requires_api_key: boolean;
  suggested_models: string[];
  docs_url: string | null;
}

/**
 * The user's bring-your-own provider connection. Never carries the API key —
 * only `api_key_hint`, a masked display fragment.
 */
export interface LLMConnection {
  configured: boolean;
  provider: string | null;
  provider_label: string | null;
  base_url: string | null;
  model: string | null;
  has_api_key: boolean;
  api_key_hint: string | null;
  providers: LLMProviderOption[];
}

export interface LLMConnectionUpdate {
  provider: string;
  base_url?: string | null;
  model: string;
  /** Omit to keep the stored key; empty string clears it. */
  api_key?: string | null;
}

export interface LLMConnectionTestResult {
  ok: boolean;
  message: string;
}

export interface LLMModelPriceInfo {
  id: string;
  input_price_per_1m: number | null;
  output_price_per_1m: number | null;
}
