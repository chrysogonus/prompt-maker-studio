/** Unauthenticated endpoints behind the free tools; no session or CSRF involved. */

import { API_URL } from '../apiBase';
import { ApiError, extractErrorMessage } from './errors';

export interface PublicModelPrice {
  id: string;
  label: string | null;
  provider: string;
  provider_label: string;
  input_price_per_1m: number | null;
  output_price_per_1m: number | null;
}

export async function getPublicModelPrices(): Promise<PublicModelPrice[]> {
  const response = await fetch(`${API_URL}/api/public/model-prices`);
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(extractErrorMessage(error?.detail) || 'Prices are unavailable right now.', response.status);
  }
  return response.json();
}

export interface PublicRefineStatus {
  available: boolean;
  max_chars: number;
}

export async function getPublicRefineStatus(): Promise<PublicRefineStatus> {
  const response = await fetch(`${API_URL}/api/public/refine`);
  if (!response.ok) return { available: false, max_chars: 0 };
  return response.json();
}

async function publicRefine<T>(step: 'questions' | 'draft', body: object): Promise<T> {
  const response = await fetch(`${API_URL}/api/public/refine/${step}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const fallback = response.status === 429
      ? 'Too many requests. Please wait a minute and try again.'
      : 'Refinement failed. Please try again.';
    throw new ApiError(extractErrorMessage(error?.detail) || fallback, response.status);
  }
  return response.json();
}

/** `website` is the form's hidden honeypot field, sent as the visitor left it. */
export function getPublicRefineQuestions(text: string, website: string, force = false) {
  return publicRefine<{ questions: string[] }>('questions', { text, website, force });
}

export function createPublicRefineDraft(text: string, website: string, qa_pairs: { question: string; answer: string }[]) {
  return publicRefine<{ text: string }>('draft', { text, website, qa_pairs });
}
