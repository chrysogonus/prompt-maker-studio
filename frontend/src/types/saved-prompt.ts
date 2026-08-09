/**
 * Type definitions for saved prompts with custom names
 */

import { PromptField } from './prompt';

export interface SavedPrompt {
  id: string; // Local ID for saved prompts
  name: string;
  promptId: number | null; // Backend prompt ID
  fields: PromptField[];
  generatedPrompt: string;
  savedAt: string;
  updatedAt?: string | null;
  folder?: string | null;
  isFavorite?: boolean;
  tags?: string[];
  runCount: number;
}
