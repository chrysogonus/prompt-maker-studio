import type { PromptHistoryResponse } from '@/types/prompt';
import { splitVariables } from '@/lib/sections';

// Long enough to notice the toast and reach Undo; the delete is sent when it ends.
export const UNDO_MS = 10000;

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
  return section ? plainText(section.content).replace(/\s+/g, ' ').trim() : '';
}

/** Imported notes are Markdown; a card preview shows their words, not fences, # or **. */
function plainText(markdown: string): string {
  return markdown
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, '')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/`([^`\n]+)`/g, '$1');
}

export function editedAt(prompt: Prompt): string {
  return prompt.content_updated_at === undefined
    ? (prompt.updated_at ?? prompt.created_at)
    : (prompt.content_updated_at ?? prompt.created_at);
}

const foldSearch = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Shared matching keeps filtering and the visible explanation in agreement.
 * Every word must appear somewhere in the prompt, in any order; the excerpt
 * shows the whole phrase where it appears as typed, otherwise the first word.
 */
export function searchMatch(prompt: Prompt, search: string) {
  const query = foldSearch(search).split(/\s+/).filter(Boolean).join(' ');
  if (!query) return null;
  const candidates = [
    { label: 'Title', text: prompt.name ?? '' },
    { label: 'Folder', text: prompt.folder ?? '' },
    ...prompt.fields.flatMap(field => [
      { label: `${field.name} (section name)`, text: field.name },
      { label: field.name, text: field.content },
    ]),
  ].map(candidate => ({ ...candidate, text: candidate.text.replace(/\s+/g, ' ').trim() }));
  const folded = candidates.map(candidate => foldSearch(candidate.text));
  const words = query.split(' ');
  if (!words.every(word => folded.some(text => text.includes(word)))) return null;
  for (const term of [query, ...words]) {
    const at = folded.findIndex(text => text.includes(term));
    if (at >= 0) return excerptAround(candidates[at], folded[at].indexOf(term), term.length);
  }
  return null;
}

function excerptAround(candidate: { label: string; text: string }, index: number, length: number) {
  const { text } = candidate;
  // Map folded offsets back to original text, including combining accents.
  let folded = 0;
  let start = 0;
  let end = text.length;
  let offset = 0;
  for (const character of text) {
    const size = foldSearch(character).length;
    if (folded <= index && size) start = offset;
    if (folded >= index + length && size) { end = offset; break; }
    folded += size;
    offset += character.length;
  }
  let from = Math.max(0, start - 24);
  let to = Math.min(text.length, end + 80);
  // Cut at spaces so the excerpt does not open or close mid-word or mid-{{variable}}.
  const opening = text.indexOf(' ', from);
  if (from > 0 && opening >= 0 && opening < start) from = opening + 1;
  const closing = text.lastIndexOf(' ', to);
  if (to < text.length && closing >= end) to = closing;
  // Widen to whole {{variables}}: a long name or spaces inside the braces can defeat the cuts above.
  let at = 0;
  for (const part of splitVariables(text)) {
    const partEnd = at + part.text.length;
    if (part.kind === 'variable') {
      if (at < from && from < partEnd) from = at;
      if (at < to && to < partEnd) to = partEnd;
    }
    at = partEnd;
  }
  return { label: candidate.label, before: `${from ? '…' : ''}${text.slice(from, start)}`, match: text.slice(start, end), after: `${text.slice(end, to)}${to < text.length ? '…' : ''}` };
}
