import { describe, expect, it } from 'vitest';
import { convertPlaceholders, findPlaceholders, isImportableFile, parseCsvPrompts, parseImportFiles, parsePromptImport, titleFromFileName } from '@/lib/promptImport';

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
    expect(parsePromptImport(source, 'Filename')).toEqual([{ name: 'Body heading', folder: 'Work', fields: [
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
    expect(findPlaceholders([{ name: 'P', folder: null, fields: [{ name: 'Prompt', content: 'See [[Writing style guide]] and [[Voice|our voice]].' }] }])).toEqual([]);
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
    expect(isImportableFile('Export/Prompts.csv')).toBe(true);
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
  it('removes Notion page properties, filing by tag and keeping the favourite', () => {
    const page = '# Cold email\n\nTags: Sales, Email\nCreated: October 1, 2026 9:00 AM\nStatus: Favourite\n\nWrite to [Name].';
    expect(parsePromptImport(page)).toEqual([{ name: 'Cold email', folder: 'Sales', is_favorite: true, fields: [{ name: 'Prompt', content: 'Write to [Name].' }] }]);
    expect(parsePromptImport(page, undefined, true)[0].fields[0].content).toContain('Tags: Sales');
  });
  it('keeps "Key: value" lines that are prompt text rather than metadata', () => {
    expect(parsePromptImport('# Tutor\nRole: You are a patient tutor.\nGoal: Explain [TOPIC].')[0]).toEqual({
      name: 'Tutor', folder: null, fields: [{ name: 'Prompt', content: 'Role: You are a patient tutor.\nGoal: Explain [TOPIC].' }],
    });
  });
  it('removes Obsidian callouts and trailing tags, reads wiki-links as text and leaves code alone', () => {
    const note = '> [!tip] Use with Claude\n> Paste the topic first.\n\nSee [[Style guide]] and [[Voice|our voice]].\nUse #fff for the background. #prompt #writing\n#draft\n```\nkeep #tag and [[link]]\n```';
    expect(parsePromptImport(note, 'Note')[0]).toEqual({ name: 'Note', folder: 'Prompt', fields: [{ name: 'Prompt', content:
      'See Style guide and our voice.\nUse #fff for the background.\n```\nkeep #tag and [[link]]\n```' }] });
    expect(parsePromptImport(note, 'Note', true)[0].fields[0].content).toBe(note);
  });
  it('files a note by its first front matter tag, written as a list or inline', () => {
    expect(parsePromptImport('---\ntags:\n  - writing\n  - blog\n---\nBody')[0].folder).toBe('Writing');
    expect(parsePromptImport('---\ntags: [dev, review]\n---\nBody')[0].folder).toBe('Dev');
  });
  it('treats the top heading of a pasted page as its title level', () => {
    expect(parsePromptImport('## Support reply\n\nReply to [message].\n\n### Rules\n- Be kind')).toEqual([{ name: 'Support reply', folder: null, fields: [
      { name: 'Prompt', content: 'Reply to [message].' }, { name: 'Rules', content: '- Be kind' },
    ] }]);
    expect(parsePromptImport('## Prompt A\nWrite about [X].\n\n## Prompt B\nSummarise [Y].').map(prompt => prompt.name)).toEqual(['Prompt A', 'Prompt B']);
    // A note that starts with text keeps its later headings as text.
    expect(parsePromptImport('Summarise this:\n\n## Output\n- Decisions', 'Meeting')[0].fields).toEqual([{ name: 'Prompt', content: 'Summarise this:\n\n## Output\n- Decisions' }]);
  });
  it('reads a database CSV: name, prompt text and tags, with quoted commas and line breaks', () => {
    const csv = '\uFEFFName,Prompt,Tags,Created\r\nCold email,"Write to [Name], briefly.\nEnd with a question.","Sales, Email",Oct 1\r\n,"Summarise ""this"" text",,\r\nEmpty,,,\r\n';
    expect(parseCsvPrompts(csv)).toEqual([
      { name: 'Cold email', folder: 'Sales', fields: [{ name: 'Prompt', content: 'Write to [Name], briefly.\nEnd with a question.' }] },
      { name: 'Summarise "this" text', folder: null, fields: [{ name: 'Prompt', content: 'Summarise "this" text' }] },
    ]);
    expect(parseCsvPrompts('Title,Notes,Long text\nA,x,The real prompt text here')[0].fields[0].content).toBe('The real prompt text here');
    expect(() => parseCsvPrompts('Name,Prompt\n')).toThrow('no rows');
  });
  it('keeps prompt text stored in a Notion property and drops only the metadata', () => {
    expect(parsePromptImport('# Cold email\n\nPrompt: Write to [Name].\nTags: Sales\nAudience: Founders\n\nMore detail.')[0]).toEqual({
      name: 'Cold email', folder: 'Sales', fields: [{ name: 'Prompt', content: 'Write to [Name].\nAudience: Founders\n\nMore detail.' }],
    });
  });
  it('turns headings with numbering, punctuation or repeats into valid, unique section names', () => {
    const note = '# Review\n## 1. Role\nA\n## Step 2: Draft (optional)\nB\n## Résumé ✨\nC\n## Example\nD\n## Example\nE\n## 2024\nF\n## ✨\nG';
    expect(parsePromptImport(note)[0].fields.map(field => field.name)).toEqual(
      ['Role', 'Step 2 Draft optional', 'Resume', 'Example', 'Example 2', 'Section 2024', 'Section']);
    // An empty default section does not take the name of a later "## Prompt".
    expect(parsePromptImport('# Notion page\n\n## Prompt\nWrite.')[0].fields).toEqual([{ name: 'Prompt', content: 'Write.' }]);
    expect(parsePromptImport(note, undefined, true)[0].fields).toHaveLength(7);
  });
  it('removes Obsidian comments, embeds, highlights and Dataview queries, and Notion callouts', () => {
    const note = 'Write a ==warm== intro about {topic}. %% try Claude %%\n%% a\nprivate note %%\n![[diagram.png]]\nSee ![[Style guide]].\n```dataview\nLIST FROM #x\n```\n<aside>\n💡 Tip for me\n\n</aside>\nKeep it short. a == b';
    expect(parsePromptImport(note, 'Intro')[0].fields[0].content).toBe('Write a warm intro about {topic}.\nSee Style guide.\nKeep it short. a == b');
    expect(parsePromptImport(note, 'Intro', true)[0].fields[0].content).toBe(note);
  });
  it('reads Windows line endings as plain lines', () => {
    expect(parsePromptImport('# Title\r\nLine one\r\nLine two\r\n')[0].fields[0].content).toBe('Line one\nLine two');
    expect(parsePromptImport('Explain <regex>\r\n', 'Regex', true)).toEqual(parsePromptImport('Explain <regex>\r\n', 'Regex'));
  });
  it('prefers exported pages to their database CSV, but keeps a CSV whose rows were not exported as pages', () => {
    const csv = 'Name,Prompt\nCold email,Write to [Name].\nFollow-up,Nudge [Name].';
    const page = { name: 'Cold email 8b7e.md', path: 'Export.zip/Library/Prompts 3f2a/Cold email 8b7e.md', text: '# Cold email\nWrite to [Name].' };
    const titles = (files: Parameters<typeof parseImportFiles>[0]) => parseImportFiles(files).prompts.map(prompt => prompt.name);
    // With pages, even when a split export put them in another part.
    expect(titles([page, { name: 'Prompts 3f2a.csv', path: 'Export-Part-2.zip/Library/Prompts 3f2a.csv', text: csv },
      { name: 'Prompts 3f2a_all.csv', path: 'Library/Prompts 3f2a_all.csv', text: csv }])).toEqual(['Cold email']);
    // Without pages: a parent page or readme beside the CSV, and only one of X.csv / X_all.csv.
    expect(titles([{ name: 'Library.md', path: 'Library.md', text: '# Library\nMy prompts.' },
      { name: 'Prompts 3f2a.csv', path: 'Library/Prompts 3f2a.csv', text: csv },
      { name: 'Prompts 3f2a_all.csv', path: 'Library/Prompts 3f2a_all.csv', text: csv }])).toEqual(['Library', 'Cold email', 'Follow-up']);
  });
  it('suggests folders without the parts of a split export', () => {
    expect(parseImportFiles([{ name: 'Library.md', path: 'Export-Part-1.zip/Library.md', text: 'Text' },
      { name: 'One.md', path: 'Export-Part-1.zip/Notes 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d/One.md', text: 'Text' }]).prompts.map(prompt => prompt.folder)).toEqual([null, 'Notes']);
  });
  it('keeps a Notion database row\'s favourite from its CSV', () => {
    expect(parseCsvPrompts('Name,Prompt,Status,Favourite\nA,Text a,Favorite,\nB,Text b,,Yes\nC,Text c,Done,No').map(prompt => prompt.is_favorite)).toEqual([true, true, undefined]);
  });
  it('refuses binary files instead of importing them as text', () => {
    expect(() => parsePromptImport('PK\u0003\u0004\u0000\u0000binary')).toThrow('not a text note');
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
