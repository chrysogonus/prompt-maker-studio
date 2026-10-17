import type { PromptCreateRequest, VariableMetadataItem } from '@/types/prompt';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const fail = (message: string): never => { throw new Error(message); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate the entire preview before making any writes. Export-only history is intentionally ignored. */
export function validateImportPrompts(value: unknown): PromptCreateRequest[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return fail('Import between 1 and 100 prompts at a time.');
  return value.map((item: unknown, index: number) => {
    const invalid = (detail: string): never => fail(`Prompt ${index + 1}: ${detail}`);
    if (!object(item)) return invalid('expected a prompt object.');
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 100) return invalid('title must contain 1–100 characters.');
    if (item.folder != null && (typeof item.folder !== 'string' || item.folder.length > 255)) return invalid('folder must contain at most 255 characters.');
    if (!Array.isArray(item.fields) || item.fields.length === 0 || item.fields.length > 100) return invalid('include 1–100 sections.');
    const tags = new Set<string>();
    const fields = item.fields.map((field: unknown) => {
      if (!object(field) || typeof field.name !== 'string' || typeof field.content !== 'string') return invalid('sections need a name and text.');
      const name = field.name.trim().replace(/\s+/g, ' ');
      if (name.length > 100 || !/^[A-Za-z_][A-Za-z0-9_ -]*$/.test(name)) return invalid('section names must start with a letter or underscore and use letters, numbers, spaces, underscores or hyphens.');
      const tag = name.replace(/ /g, '_').toUpperCase();
      if (tags.has(tag)) return invalid('section names must be unique.');
      tags.add(tag);
      if (field.content.length > 10000) return invalid('section text exceeds 10,000 characters.');
      return { name, content: field.content };
    });
    const prompt: PromptCreateRequest = { name: item.name.trim(), folder: typeof item.folder === 'string' ? item.folder.trim() : null, fields };
    if (item.variable_metadata != null) {
      if (!object(item.variable_metadata)) return invalid('invalid variable metadata.');
      const entries = Object.entries(item.variable_metadata).map(([key, metadata]) => {
        if (!object(metadata) || !['text', 'number', 'boolean', 'list'].includes(String(metadata.type))) return invalid('invalid variable type.');
        if (metadata.required !== undefined && typeof metadata.required !== 'boolean') return invalid('invalid variable required flag.');
        for (const [field, max] of [['description', 500], ['example', 10000]] as const) {
          if (metadata[field] != null && (typeof metadata[field] !== 'string' || metadata[field].length > max)) return invalid(`invalid variable ${field}.`);
        }
        return [key, { type: metadata.type, ...(metadata.required !== undefined && { required: metadata.required }), ...(metadata.description !== undefined && { description: metadata.description }), ...(metadata.example !== undefined && { example: metadata.example }) } as VariableMetadataItem];
      });
      prompt.variable_metadata = Object.fromEntries(entries);
    }
    return prompt;
  });
}

export function parsePromptImport(source: string, suggestedTitle = 'Imported note'): PromptCreateRequest[] {
  if (new Blob([source]).size > MAX_IMPORT_BYTES) fail('Import files must be 5 MB or smaller.');
  const text = source.trim();
  if (/^[{[]/.test(text)) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { return fail('Invalid JSON. Choose a Prompt Maker Studio JSON export.'); }
    if (!object(data) || !Array.isArray(data.prompts)) return fail('Expected a JSON export with a prompts array.');
    return validateImportPrompts(data.prompts.map((prompt: unknown, index: number) => object(prompt) && prompt.name == null ? { ...prompt, name: `Imported prompt ${index + 1}` } : prompt));
  }
  if (!text) return fail('Include some note text or a JSON export.');
  // Single notes retain every character, including frontmatter and headings.
  if (!/^# .+/.test(text)) {
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    const scalar = frontmatter?.match(/^title:[ \t]*(.+)$/m)?.[1].trim();
    // ponytail: support simple one-line scalar titles; preserve complex YAML as text.
    let title: string | undefined;
    if (scalar?.startsWith('"')) {
      try { const parsed: unknown = JSON.parse(scalar); if (typeof parsed === 'string') title = parsed; } catch { /* Preserve unsupported YAML below. */ }
    } else if (scalar?.startsWith("'")) {
      if (/^'(?:[^']|'')*'$/.test(scalar)) title = scalar.slice(1, -1).replace(/''/g, "'");
    } else if (scalar && !/^[|>!&*[{]/.test(scalar)) title = scalar.replace(/\s+#.*$/, '');
    return validateImportPrompts([{ name: title?.trim() || suggestedTitle.trim() || 'Imported note', folder: null, fields: [{ name: 'Prompt', content: source }] }]);
  }
  const prompts: PromptCreateRequest[] = [];
  let current: PromptCreateRequest | undefined;
  let section: { name: string; content: string } | undefined;
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    const heading = !fence && !marker ? line.match(/^(#{1,2}) (.+)$/) : null;
    if (heading?.[1] === '#') {
      current = { name: heading[2].trim(), folder: null, fields: [] };
      prompts.push(current);
      section = undefined;
    } else if (heading?.[1] === '##' && current) {
      section = { name: heading[2].trim(), content: '' };
      current.fields.push(section);
    } else {
      if (!current) { if (line.trim()) fail('Start each Markdown prompt with # Title. Use ## Section for optional sections.'); continue; }
      if (!section) { section = { name: 'Prompt', content: '' }; current.fields.push(section); }
      section.content += `${line}\n`;
    }
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = null;
    }
  }
  for (const prompt of prompts) for (const field of prompt.fields) field.content = field.content.trim();
  // Whitespace before the first explicit section is not its own section.
  for (const prompt of prompts) prompt.fields = prompt.fields.filter(field => field.name !== 'Prompt' || field.content || prompt.fields.length === 1);
  return validateImportPrompts(prompts);
}
