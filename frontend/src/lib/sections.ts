/**
 * A prompt is an ordered list of named sections. The server renders the text
 * from them (backend/app/services/prompt_sections.py); `renderSections` mirrors
 * that exactly so the preview shows what gets saved and copied.
 */

import { PromptField } from '@/types/prompt';

const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;
const TAG = /<(\/?)([A-Za-z_][A-Za-z0-9_-]*)>/g;
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_ -]*$/;

/** Trim and collapse whitespace, as the server does before storing a name. */
export function normalizeSectionName(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(' ');
}

/** The XML tag a section renders as: `Output format` becomes `OUTPUT_FORMAT`. */
export function sectionTag(name: string): string {
  return normalizeSectionName(name).replace(/ /g, '_').toUpperCase();
}

export function renderSections(sections: PromptField[]): string {
  return sections
    .map(({ name, content }) => `<${sectionTag(name)}>\n${content}\n</${sectionTag(name)}>`)
    .join('\n\n');
}

/** Plain output removes only the app's wrappers, preserving each section's text. */
export function renderPlainSections(sections: PromptField[]): string {
  return sections.map((section) => section.content).join('\n\n');
}

/** Why a section name can't be saved, or null when it can. */
export function sectionNameError(name: string, others: string[]): string | null {
  const normalized = normalizeSectionName(name);
  if (!normalized) return 'Give this section a name.';
  if (!VALID_NAME.test(normalized)) {
    return 'Start with a letter. Use letters, numbers, spaces, - or _.';
  }
  if (others.some((other) => sectionTag(other) === sectionTag(normalized))) {
    return `Another section already becomes <${sectionTag(normalized)}>. Names must be unique.`;
  }
  return null;
}

/** `{{variable}}` names in order of first appearance across all sections. */
export function variablesIn(sections: PromptField[]): string[] {
  const names: string[] = [];
  for (const { content } of sections) {
    for (const match of content.matchAll(VARIABLE)) {
      if (!names.includes(match[1])) names.push(match[1]);
    }
  }
  return names;
}

/** A short, scannable name from the first line of pasted text; the user can still edit it. */
export function suggestTitle(text: string, max = 60): string {
  const line = (text.trim().split(/\r?\n/)[0] ?? '')
    .replace(VARIABLE, ' ')
    .replace(/^[\s#>*-]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim();
  if (line.length <= max) return line;
  const space = line.lastIndexOf(' ', max);
  return line.slice(0, space > 0 ? space : max).replace(/[\s,;:-]+$/, '');
}

/** Replace each filled-in variable; unfilled ones stay as `{{name}}`. */
export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE, (token, name: string) => (values[name] ? values[name] : token));
}

export interface TextPart {
  kind: 'text' | 'variable';
  text: string;
  name?: string;
}

/** Split text into plain runs and `{{variable}}` tokens, for highlighting. */
export function splitVariables(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(VARIABLE)) {
    if (match.index > last) parts.push({ kind: 'text', text: text.slice(last, match.index) });
    parts.push({ kind: 'variable', text: match[0], name: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** Tags typed inside a section whose opening and closing counts differ. */
export function unbalancedTags(content: string): string[] {
  const counts = new Map<string, number>();
  for (const [, closing, name] of content.matchAll(TAG)) {
    counts.set(name, (counts.get(name) ?? 0) + (closing ? -1 : 1));
  }
  return [...counts].filter(([, balance]) => balance !== 0).map(([name]) => name);
}
