import { storageKey } from '@/lib/branding';
import { suggestTitle } from '@/lib/sections';
import type { PromptCreateRequest, VariableMetadataItem } from '@/types/prompt';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** Hands a pasted note from the library to the editor's AI conversion, once. */
export const pasteHandoffKey = () => storageKey('paste-handoff');

/** A favorite flag can't be sent on create, so it is applied after. */
export type ImportPrompt = PromptCreateRequest & { is_favorite?: true };
const fail = (message: string): never => { throw new Error(message); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate the entire preview before making any writes. Export-only history is intentionally ignored. */
export function validateImportPrompts(value: unknown): ImportPrompt[] {
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
    const prompt: ImportPrompt = { name: item.name.trim(), folder: typeof item.folder === 'string' ? item.folder.trim() : null, fields,
      ...(item.is_favorite === true && { is_favorite: true as const }) };
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

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function frontmatterTitle(frontmatter: string): string | undefined {
  const scalar = frontmatter.match(/^title:[ \t]*(.+)$/m)?.[1].trim();
  // ponytail: support simple one-line scalar titles; preserve complex YAML as text.
  let title: string | undefined;
  if (scalar?.startsWith('"')) {
    try { const parsed: unknown = JSON.parse(scalar); if (typeof parsed === 'string') title = parsed; } catch { /* Unsupported YAML is ignored. */ }
  } else if (scalar?.startsWith("'")) {
    if (/^'(?:[^']|'')*'$/.test(scalar)) title = scalar.slice(1, -1).replace(/''/g, "'");
  } else if (scalar && !/^[|>!&*[{]/.test(scalar)) title = scalar.replace(/\s+#.*$/, '');
  return title?.trim() || undefined;
}

function frontmatterTags(frontmatter: string): string[] {
  const inline = frontmatter.match(/^tags:[ \t]*\[?([^\]\n]+)\]?[ \t]*$/m)?.[1];
  const list = frontmatter.match(/^tags:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m)?.[1];
  const raw = inline ? inline.split(',') : list ? list.split('\n').map(line => line.replace(/^[ \t]*-[ \t]*/, '')) : [];
  return raw.map(tag => tag.trim().replace(/^['"#]|['"]$/g, '')).filter(Boolean);
}

/** Lines outside code fences, so code samples are never rewritten. */
function mapProse(text: string, line: (value: string) => string | null): string {
  let fence: string | null = null;
  const out: string[] = [];
  for (const value of text.split('\n')) {
    const marker = value.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? null : marker;
      out.push(value);
      continue;
    }
    const next = fence ? value : line(value);
    if (next !== null) out.push(next);
  }
  return out.join('\n');
}

/**
 * A pasted Notion page often starts at `##`. When the text opens with a heading
 * and has no `# Title`, its top heading level becomes the title level.
 */
function promoteHeadings(text: string): string {
  const first = text.trim().match(/^(#{2,6}) \S/)?.[1];
  if (!first || /^# \S/m.test(mapProse(text, line => /^# \S/.test(line) ? line : ''))) return text;
  const shift = first.length - 1;
  return mapProse(text, line => line.replace(/^(#{2,6})(?= \S)/, hashes => '#'.repeat(Math.max(1, hashes.length - shift))));
}

// Notion writes page properties as "Key: value" lines under the title; only a block
// naming familiar metadata is removed, so a prompt starting "Role: …" stays intact.
const PROPERTY_BLOCK = /^((?:[A-Z][\w ]{0,30}: [^\n]*(?:\n|$))+)\n*/;
const METADATA_KEY = /^(tags?|created( time| by)?|last edited( time| by)?|status|category|type|date|url|favou?rite|owner|author|model|source):/i;
const PROMPT_KEY = /^(prompt|content|text|body|instructions?)$/i;
const TRAILING_TAG = /(?:^|\s)(#[A-Za-z][\w/-]*)$/;
const HEX_COLOUR = /^#(?:[0-9a-f]{3}){1,2}$/i;

/** Remove note-app metadata from imported prompt text and keep its tags and favourite flag. */
function tidyNote(prompt: ImportPrompt, noteTags: string[]): ImportPrompt {
  const tags = [...noteTags];
  let favorite = false;
  const fields = prompt.fields.map((field, index) => {
    let content = field.content;
    const properties = index === 0 ? content.match(PROPERTY_BLOCK) : null;
    if (properties && properties[1].split('\n').some(line => METADATA_KEY.test(line))) {
      const kept: string[] = [];
      for (const line of properties[1].split('\n').filter(Boolean)) {
        const [, key = '', value = ''] = line.match(/^([^:]+):\s*(.*)$/) ?? [];
        if (/^tags?$/i.test(key)) tags.push(...value.split(','));
        if ((/^status$/i.test(key) && /favou?rite/i.test(value)) || (/^favou?rite$/i.test(key) && /^(yes|true|x|✓)$/i.test(value.trim()))) favorite = true;
        // Only metadata goes; a database's prompt text often lives in a property.
        if (!METADATA_KEY.test(line)) kept.push(PROMPT_KEY.test(key) ? value : line);
      }
      content = [kept.join('\n'), content.slice(properties[0].length)].filter(Boolean).join('\n\n');
    }
    let inCallout = false;
    content = mapProse(content, line => {
      // Obsidian callouts are notes to the reader, not instructions to a model.
      if (/^>\s*\[![\w-]+\]/.test(line)) { inCallout = true; return null; }
      if (inCallout && /^>/.test(line)) return null;
      inCallout = false;
      // Obsidian tags at the end of a line (or a line of only tags) become folder suggestions.
      let kept = line.trimEnd();
      const lineTags: string[] = [];
      for (let tag = kept.match(TRAILING_TAG); tag && !HEX_COLOUR.test(tag[1]); tag = kept.match(TRAILING_TAG)) {
        lineTags.unshift(tag[1].slice(1));
        kept = kept.slice(0, kept.length - tag[0].length).trimEnd();
      }
      tags.push(...lineTags);
      if (!kept && line.trim()) return null;
      // [[Page]] and [[Page|label]] read as their text.
      return kept.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, page: string, label?: string) => label ?? page);
    });
    return content === field.content ? field : { ...field, content: content.trim() };
  }).filter((field, _, all) => field.content.trim() || all.length === 1);
  const tag = tags.map(value => value.trim().replace(/^#/, '')).find(Boolean);
  return {
    ...prompt,
    fields,
    folder: prompt.folder ?? (tag ? tag[0].toUpperCase() + tag.slice(1) : null),
    ...(favorite ? { is_favorite: true as const } : {}),
  };
}

/**
 * Frontmatter is note metadata, not prompt text, so it is removed unless
 * `keepOriginal` is set; the rest of the note is then read like any Markdown
 * prompt, so a leading `# Title` becomes the title instead of prompt text.
 */
export function parsePromptImport(source: string, suggestedTitle = 'Imported note', keepOriginal = false): ImportPrompt[] {
  if (new Blob([source]).size > MAX_IMPORT_BYTES) fail('Import files must be 5 MB or smaller.');
  if (source.includes('\u0000')) fail('This is not a text note. Choose .md, .txt, .csv or .json files, or a Notion .zip export.');
  const text = source.trim();
  if (/^[{[]/.test(text)) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { return fail('Invalid JSON. Choose a Prompt Maker Studio JSON export.'); }
    if (!object(data) || !Array.isArray(data.prompts)) return fail('Expected a JSON export with a prompts array.');
    return validateImportPrompts(data.prompts.map((prompt: unknown, index: number) => object(prompt) && prompt.name == null ? { ...prompt, name: `Imported prompt ${index + 1}` } : prompt));
  }
  if (!text) return fail('Include some note text or a JSON export.');
  const frontmatter = text.match(FRONTMATTER);
  const title = frontmatter ? frontmatterTitle(frontmatter[1]) : undefined;
  const body = frontmatter ? text.slice(frontmatter[0].length).trim() : '';
  if (!keepOriginal && (body || !frontmatter)) {
    const tags = frontmatter ? frontmatterTags(frontmatter[1]) : [];
    const note = promoteHeadings(frontmatter ? body : source);
    return validateImportPrompts(parsePromptImport(note, title || suggestedTitle, true).map(prompt => tidyNote(prompt, tags)));
  }
  // Otherwise a single note retains every character, including frontmatter and headings.
  if (!/^# .+/.test(text)) {
    return validateImportPrompts([{ name: title || suggestedTitle.trim() || suggestTitle(text) || 'Imported note', folder: null, fields: [{ name: 'Prompt', content: source }] }]);
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

// [TOPIC] or [insert topic] (not a Markdown link, a [[wiki-link]] or arr[i]), {topic}
// (not {{topic}}), and <transcript> when no </transcript> closes it as a tag.
// ponytail: heuristic; people see the list and choose before anything changes.
const PLACEHOLDER = /(?<![\w\][])\[([A-Za-z][\w -]{1,40})\](?![\](])|(?<![{\w])\{([A-Za-z][\w -]{0,40})\}(?!\})|<([a-z][a-z0-9_ -]{1,40})>/g;

const placeholderName = (inner: string) => inner.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');

function placeholdersIn(content: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of content.matchAll(PLACEHOLDER)) {
    const inner = match[1] ?? match[2] ?? match[3];
    if (match[3] && content.includes(`</${match[3]}>`)) continue;
    const name = placeholderName(inner);
    if (/^[a-z_][a-z0-9_]*$/.test(name)) found.set(match[0], name);
  }
  return found;
}

/** Placeholder spellings that could become `{{inputs}}`, in order of appearance. */
export function findPlaceholders(prompts: ImportPrompt[]): string[] {
  return [...new Set(prompts.flatMap(prompt => prompt.fields.flatMap(field => [...placeholdersIn(field.content).keys()])))];
}

/** "[PASTE CODE HERE]" reads as the hint "Paste code here". */
const placeholderHint = (token: string) => {
  const inner = token.slice(1, -1).trim().replace(/[_-]+/g, ' ');
  return inner.charAt(0).toUpperCase() + inner.slice(1).toLowerCase();
};

/**
 * Rewrite the chosen placeholders (all by default) as `{{name}}` inputs, keeping
 * each placeholder's wording as its input's hint unless the input already has one.
 */
export function convertPlaceholders(prompts: ImportPrompt[], chosen?: string[]): ImportPrompt[] {
  return prompts.map(prompt => {
    const metadata = { ...prompt.variable_metadata };
    const fields = prompt.fields.map(field => {
      const found = placeholdersIn(field.content);
      return { ...field, content: field.content.replace(PLACEHOLDER, token => {
        const name = found.get(token);
        if (!name || (chosen && !chosen.includes(token))) return token;
        metadata[name] = { ...(metadata[name] ?? { type: 'text' }), description: metadata[name]?.description || placeholderHint(token) };
        return `{{${name}}}`;
      }) };
    });
    return Object.keys(metadata).length ? { ...prompt, fields, variable_metadata: metadata } : { ...prompt, fields };
  });
}

/** A file name as a title: no extension, and no Notion page ID such as "Cold email 8b7e…". */
const NOTION_ID = /\s+[0-9a-f]{16,32}$/i;
export const titleFromFileName = (name: string) =>
  name.replace(/\.[^.]+$/, '').replace(NOTION_ID, '').trim().slice(0, 100);

/** Files worth reading from a chosen or dropped folder: notes and exports, not app settings. */
export const isImportableFile = (path: string) =>
  /\.(md|markdown|txt|json|csv)$/i.test(path) && !path.split('/').some(part => part.startsWith('.'));

/** Rows of a CSV file (RFC 4180: quoted fields may hold commas, quotes and line breaks). */
function csvRows(text: string): string[][] {
  const rows: string[][] = [[]];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { rows[rows.length - 1].push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      rows[rows.length - 1].push(field); field = ''; rows.push([]);
    } else field += char;
  }
  rows[rows.length - 1].push(field);
  return rows.filter(row => row.some(cell => cell.trim()));
}

/**
 * A database export (Notion, Airtable, a spreadsheet) as prompts: the Name or Title
 * column titles each row, a Prompt-like column (or else the longest text column)
 * holds its text, and Tags suggests its folder.
 */
export function parseCsvPrompts(text: string): ImportPrompt[] {
  const [header, ...rows] = csvRows(text.replace(/^\uFEFF/, ''));
  if (!header || !rows.length) return fail('This CSV file has no rows.');
  const column = (pattern: RegExp) => header.findIndex(name => pattern.test(name.trim()));
  const titleAt = Math.max(0, column(/^(name|title)$/i));
  const tagsAt = column(/^tags?$/i);
  let promptAt = column(PROMPT_KEY);
  if (promptAt < 0) {
    const lengths = header.map((_, i) => i === titleAt || i === tagsAt ? -1 : rows.reduce((total, row) => total + (row[i]?.length ?? 0), 0));
    promptAt = lengths.indexOf(Math.max(...lengths));
  }
  if (promptAt < 0 || promptAt === titleAt) return fail('No column with prompt text was found in this CSV file.');
  return validateImportPrompts(rows.filter(row => row[promptAt]?.trim()).map(row => {
    const tag = row[tagsAt]?.split(',')[0]?.trim();
    return {
      name: (row[titleAt]?.trim() || suggestTitle(row[promptAt]) || 'Imported prompt').slice(0, 100),
      folder: tag ? tag[0].toUpperCase() + tag.slice(1) : null,
      fields: [{ name: 'Prompt', content: row[promptAt].trim() }],
    };
  }));
}

export interface ImportFile { name: string; path: string; text: string }

/**
 * Several files become one preview. A file's folder (from a chosen folder) is its
 * suggested folder; a file that holds no prompts is reported instead of failing the rest.
 */
export function parseImportFiles(files: ImportFile[], keepOriginal = false): { prompts: ImportPrompt[]; skipped: string[] } {
  const prompts: ImportPrompt[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const folder = (file.path.split('/').slice(0, -1).pop() ?? '').replace(NOTION_ID, '').trim() || null;
    try {
      const parsed = /\.csv$/i.test(file.name) ? parseCsvPrompts(file.text) : parsePromptImport(file.text, titleFromFileName(file.name), keepOriginal);
      prompts.push(...parsed.map(prompt => ({ ...prompt, folder: prompt.folder ?? folder })));
    } catch (error) {
      skipped.push(`${file.name}: ${(error as Error).message}`);
    }
  }
  if (prompts.length > 100) fail(`These files hold ${prompts.length} prompts. Import up to 100 at a time.`);
  return { prompts, skipped };
}
