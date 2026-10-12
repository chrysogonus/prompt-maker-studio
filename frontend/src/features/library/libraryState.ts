import type { PromptHistoryResponse } from '@/types/prompt';

export const UNDO_MS = 5000;

export type Prompt = PromptHistoryResponse;

export interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}

export function excerpt(prompt: Prompt): string {
  const section =
    prompt.fields.find((f) => f.content.trim() && !/^\s*\{\{[^}]+\}\}\s*$/.test(f.content)) ??
    prompt.fields[0];
  return section ? section.content.replace(/\s+/g, ' ').trim() : '';
}

export function editedAt(prompt: Prompt): string {
  return prompt.updated_at ?? prompt.created_at;
}
