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
