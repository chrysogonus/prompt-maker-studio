import type { PromptHistoryResponse } from '@/types/prompt';

export const UNDO_MS = 5000;

export type Prompt = PromptHistoryResponse;

export interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}

/** The task says what a prompt does better than a shared role line, so prefer it. */
export function excerpt(prompt: Prompt): string {
  const readable = prompt.fields.filter((f) => f.content.trim() && !/^\s*\{\{[^}]+\}\}\s*$/.test(f.content));
  const section =
    readable.find((f) => f.name.trim().toLowerCase() === 'task') ?? readable[0] ?? prompt.fields[0];
  return section ? section.content.replace(/\s+/g, ' ').trim() : '';
}

export function editedAt(prompt: Prompt): string {
  return prompt.content_updated_at === undefined
    ? (prompt.updated_at ?? prompt.created_at)
    : (prompt.content_updated_at ?? prompt.created_at);
}

const foldSearch = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Shared matching keeps filtering and the visible explanation in agreement. */
export function searchMatch(prompt: Prompt, search: string) {
  const query = foldSearch(search.trim());
  if (!query) return null;
  const candidates = [
    { label: 'Title', text: prompt.name ?? '' },
    { label: 'Folder', text: prompt.folder ?? '' },
    ...prompt.fields.flatMap(field => [
      { label: `${field.name} (section name)`, text: field.name },
      { label: field.name, text: field.content },
    ]),
  ];
  for (const candidate of candidates) {
    const text = candidate.text.replace(/\s+/g, ' ').trim();
    const index = foldSearch(text).indexOf(query);
    if (index < 0) continue;
    // Map folded offsets back to original text, including combining accents.
    let folded = 0;
    let start = 0;
    let end = text.length;
    let offset = 0;
    for (const character of text) {
      const length = foldSearch(character).length;
      if (folded <= index && length) start = offset;
      if (folded >= index + query.length && length) { end = offset; break; }
      folded += length;
      offset += character.length;
    }
    const from = Math.max(0, start - 24);
    const to = Math.min(text.length, end + 80);
    return { label: candidate.label, before: `${from ? '…' : ''}${text.slice(from, start)}`, match: text.slice(start, end), after: `${text.slice(end, to)}${to < text.length ? '…' : ''}` };
  }
  return null;
}
