import { describe, expect, it } from 'vitest';
import { convertPlaceholders, findPlaceholders, hasFrontmatter, isImportableFile, parseImportFiles, parsePromptImport, titleFromFileName } from '@/lib/promptImport';

describe('prompt import', () => {
  it('restores export sections, folder and variable metadata without server-only data', () => {
    const fields = [{ name: 'Task', content: 'Hello {{name}}' }];
    expect(parsePromptImport(JSON.stringify({ exported_at: 'now', prompts: [{
      id: 8, name: 'Greeting', fields, folder: 'Work', versions: [], tags: ['old'],
      variable_metadata: { name: { type: 'text', required: true } },
    }] }))).toEqual([{ name: 'Greeting', fields, folder: 'Work', variable_metadata: { name: { type: 'text', required: true } } }]);
  });
  it('reads explicit Markdown prompt and section headings, including fenced headings', () => {
    expect(parsePromptImport('# First\n## Role\nBe kind\n## Task\n```md\n# example\n```\n# Second\nBody')).toEqual([
      { name: 'First', folder: null, fields: [{ name: 'Role', content: 'Be kind' }, { name: 'Task', content: '```md\n# example\n```' }] },
      { name: 'Second', folder: null, fields: [{ name: 'Prompt', content: 'Body' }] },
    ]);
  });
  it('preserves a single note verbatim and uses the suggested title', () => {
    const source = '  A note\n## Nested heading\n```md\n# Example\n```\n';
    expect(parsePromptImport(source, 'Daily note')).toEqual([{ name: 'Daily note', folder: null, fields: [{ name: 'Prompt', content: source }] }]);
  });
  it('removes frontmatter and reads the rest as Markdown, using its # Title', () => {
    const source = '---\ntitle: "Café notes"\ntags: [work, draft]\n---\n# Body heading\nA note\n## Output\nThree bullets';
    expect(hasFrontmatter(source)).toBe(true);
    expect(parsePromptImport(source, 'Filename')).toEqual([{ name: 'Body heading', folder: null, fields: [
      { name: 'Prompt', content: 'A note' }, { name: 'Output', content: 'Three bullets' },
    ] }]);
  });
  it('titles a frontmatter note without a heading from its frontmatter, then the fallback', () => {
    expect(parsePromptImport("---\ntitle: 'Daily'\n---\nBody", 'Filename')).toEqual([{ name: 'Daily', folder: null, fields: [{ name: 'Prompt', content: 'Body' }] }]);
    expect(parsePromptImport('---\ntitle: |\n  Multiline title\n---\nBody')).toEqual([{ name: 'Imported note', folder: null, fields: [{ name: 'Prompt', content: 'Body' }] }]);
  });
  it('keeps the original note, frontmatter included, when asked', () => {
    const source = '---\ntitle: "Café notes"\ntags: [work, draft]\n---\n# Body heading\nA note';
    expect(parsePromptImport(source, 'Filename', true)).toEqual([{ name: 'Café notes', folder: null, fields: [{ name: 'Prompt', content: source }] }]);
    const complex = '---\ntitle: |\n  Multiline title\n---\nBody';
    expect(parsePromptImport(complex, undefined, true)[0]).toEqual({ name: 'Imported note', folder: null, fields: [{ name: 'Prompt', content: complex }] });
  });
  it('keeps a note that is only frontmatter as written', () => {
    expect(parsePromptImport('---\ntitle: Empty\n---')[0].fields[0].content).toBe('---\ntitle: Empty\n---');
  });
  it('finds and converts common placeholder spellings into inputs', () => {
    const prompts = [{ name: 'P', folder: null, fields: [{ name: 'Prompt', content:
      'Outline [TOPIC] for [target audience] in a {tone} voice. Use <transcript>. Keep {{format}}, <ROLE>x</ROLE>, <example>e</example>, [a link](https://x.y), arr[i] and [ ].' }] }];
    expect(findPlaceholders(prompts)).toEqual(['[TOPIC]', '[target audience]', '{tone}', '<transcript>']);
    expect(convertPlaceholders(prompts)[0].fields[0].content).toBe(
      'Outline {{topic}} for {{target_audience}} in a {{tone}} voice. Use {{transcript}}. Keep {{format}}, <ROLE>x</ROLE>, <example>e</example>, [a link](https://x.y), arr[i] and [ ].');
    expect(findPlaceholders(convertPlaceholders(prompts))).toEqual([]);
  });
  it('titles files from their names without extensions or Notion page IDs', () => {
    expect(titleFromFileName('Cold email 8b7e6d5c4a3b2a1f8b7e6d5c4a3b2a1f.md')).toBe('Cold email');
    expect(titleFromFileName('Weekly report.markdown')).toBe('Weekly report');
    expect(titleFromFileName('Version 2 notes.md')).toBe('Version 2 notes');
  });
  it('reads notes and exports from a folder but not app settings or other files', () => {
    expect(isImportableFile('Vault/Prompts/Blog.md')).toBe(true);
    expect(isImportableFile('Vault/export.json')).toBe(true);
    expect(isImportableFile('Vault/.obsidian/app.json')).toBe(false);
    expect(isImportableFile('Vault/.trash/Old.md')).toBe(false);
    expect(isImportableFile('Vault/image.png')).toBe(false);
  });
  it('merges several files, suggesting each note\'s folder and reporting files without prompts', () => {
    const { prompts, skipped } = parseImportFiles([
      { name: 'Blog.md', path: 'Vault/Prompts/Blog.md', text: 'Outline [TOPIC].' },
      { name: 'Two.md', path: 'Two.md', text: '# One\nA\n# Two\nB' },
      { name: 'Empty.md', path: 'Vault/Empty.md', text: '   ' },
    ]);
    expect(prompts.map(prompt => [prompt.name, prompt.folder])).toEqual([['Blog', 'Prompts'], ['One', null], ['Two', null]]);
    expect(skipped).toEqual(['Empty.md: Include some note text or a JSON export.']);
    const many = Array.from({ length: 101 }, (_, i) => ({ name: `${i}.md`, path: `${i}.md`, text: `Prompt ${i}` }));
    expect(() => parseImportFiles(many)).toThrow('101 prompts');
  });
  it('keeps the 5 MB and 100 prompt limits', () => {
    expect(() => parsePromptImport('x'.repeat(5 * 1024 * 1024 + 1))).toThrow('5 MB');
    expect(() => parsePromptImport(Array.from({ length: 101 }, (_, i) => `# Note ${i}\nText`).join('\n'))).toThrow('100 prompts');
  });
  it.each([
    '', '{broken', '{"prompts":[]}',
    JSON.stringify({ prompts: [{ name: 'OK', fields: [{ name: 'Task', content: 'OK' }] }, { name: 'Bad', fields: [] }] }),
    JSON.stringify({ prompts: [{ name: 'Bad', fields: [{ name: 'a b', content: '' }, { name: 'a_b', content: '' }] }] }),
    JSON.stringify({ prompts: [{ name: 'Bad', fields: [{ name: 'Task', content: 'x'.repeat(10001) }] }] }),
    JSON.stringify({ prompts: [{ name: 'Bad', fields: [{ name: 'Task', content: '' }], variable_metadata: { x: { type: 'unsupported' } } }] }),
  ])('rejects invalid content before saving: %s', input => {
    expect(() => parsePromptImport(input)).toThrow();
  });
});
