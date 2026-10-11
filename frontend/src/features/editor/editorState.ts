import { normalizeSectionName } from '@/lib/sections';

import { PromptField, VariableMetadataItem } from '@/types/prompt';

export interface EditorSection {
  /** Stable React key; names can change and repeat while being typed. */
  key: number;
  name: string;
  content: string;
  hint?: string;
  /** Empty-section feedback waits until the section has been left once. */
  touched: boolean;
}

export type Metadata = Record<string, VariableMetadataItem>;

export interface Draft {
  /** Snapshot of the saved prompt the draft was based on; null for a new prompt. */
  base: string | null;
  sections: PromptField[];
  metadata: Metadata;
}

export interface Notice {
  text: string;
  tone?: 'error';
  action?: { label: string; run: () => void };
}

const NEW_SECTION_HINT =
  'Write your prompt here. Put the parts that change each time in {{double_braces}}.';

let nextKey = 1;

export function toEditorSections(
  fields: { name: string; content: string; hint?: string }[],
  touched: boolean,
): EditorSection[] {
  return fields.map(({ name, content, hint }) => ({ key: nextKey++, name, content, hint, touched }));
}

export function blankSections(): EditorSection[] {
  return toEditorSections([{ name: 'Task', content: '', hint: NEW_SECTION_HINT }], false);
}

export function toFields(sections: EditorSection[]): PromptField[] {
  return sections.map(({ name, content }) => ({ name: normalizeSectionName(name), content }));
}

export function snapshot(fields: PromptField[], metadata: Metadata | null | undefined): string {
  const sorted = Object.keys(metadata ?? {})
    .sort()
    .map((key) => [key, metadata![key]]);
  return JSON.stringify({ fields, metadata: sorted });
}

export function readDraft(key: string | null): Draft | null {
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function uniqueName(sections: EditorSection[]): string {
  let n = sections.length + 1;
  const taken = new Set(sections.map((s) => normalizeSectionName(s.name).toLowerCase()));
  while (taken.has(`section ${n}`)) n += 1;
  return `Section ${n}`;
}

export interface PromptEditorProps {
  /** Omitted for a new, not yet saved prompt. */
  promptId?: number;
  /** New prompts only: a starter template id to begin from, unless a draft exists. */
  initialStarter?: string;
  /** New prompts only: open Import text straight away. */
  openImport?: boolean;
}
