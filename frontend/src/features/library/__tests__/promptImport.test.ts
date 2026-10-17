import { describe, expect, it } from 'vitest';
import { parsePromptImport } from '@/lib/promptImport';

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
  it('uses a simple frontmatter title while preserving all metadata as note content', () => {
    const source = '---\ntitle: "Café notes"\ntags: [work, draft]\n---\n# Body heading\nA note';
    expect(parsePromptImport(source, 'Filename')).toEqual([{ name: 'Café notes', folder: null, fields: [{ name: 'Prompt', content: source }] }]);
  });
  it('uses the fallback for complex YAML titles without discarding frontmatter', () => {
    const source = '---\ntitle: |\n  Multiline title\n---\nBody';
    expect(parsePromptImport(source)[0]).toEqual({ name: 'Imported note', folder: null, fields: [{ name: 'Prompt', content: source }] });
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
