import { describe, expect, it } from 'vitest';
import { extractPromptPlaceholders } from '../placeholders';
import { buildSnippetVariables, generatePythonSnippet, generateTypeScriptSnippet } from '../codeSnippets';

const TEMPLATE = '<GOAL>\ntriage {{ticket_text}} for [Insert customer name]\n</GOAL>';

function balanced(code: string, open: string, close: string): boolean {
  let depth = 0;
  for (const char of code) {
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe('codeSnippets', () => {
  it('sanitizes placeholder labels into unique, valid identifiers', () => {
    const placeholders = extractPromptPlaceholders(TEMPLATE);
    const variables = buildSnippetVariables(placeholders);

    expect(variables.map((v) => v.paramName)).toEqual(['ticket_text', 'insert_customer_name']);
    variables.forEach((v) => expect(v.paramName).toMatch(/^[a-z_][a-z0-9_]*$/));
  });

  it('applies variable_metadata types when provided', () => {
    const placeholders = extractPromptPlaceholders(TEMPLATE);
    const variables = buildSnippetVariables(placeholders, {
      ticket_text: { type: 'number' },
    });

    expect(variables[0]).toMatchObject({ paramName: 'ticket_text', type: 'number' });
    expect(variables[1]).toMatchObject({ type: 'text' });
  });

  it('generates a syntactically-sane Python snippet with at least one variable', () => {
    const placeholders = extractPromptPlaceholders(TEMPLATE);
    const variables = buildSnippetVariables(placeholders);
    const snippet = generatePythonSnippet(TEMPLATE, variables);

    expect(snippet).toContain('from openai import OpenAI');
    expect(snippet).toContain('PROMPT_TEMPLATE = ');
    expect(snippet).toContain('def build_prompt(ticket_text: str, insert_customer_name: str) -> str:');
    expect(snippet).toContain('prompt.replace("{{ticket_text}}", str(ticket_text))');
    expect(snippet).toContain('def run(ticket_text: str, insert_customer_name: str):');
    expect(balanced(snippet, '(', ')')).toBe(true);
    expect(balanced(snippet, '[', ']')).toBe(true);
  });

  it('generates a syntactically-sane TypeScript snippet with at least one variable', () => {
    const placeholders = extractPromptPlaceholders(TEMPLATE);
    const variables = buildSnippetVariables(placeholders);
    const snippet = generateTypeScriptSnippet(TEMPLATE, variables);

    expect(snippet).toContain("import OpenAI from 'openai';");
    expect(snippet).toContain('const PROMPT_TEMPLATE = ');
    expect(snippet).toContain(
      'function buildPrompt(ticket_text: string, insert_customer_name: string): string {'
    );
    expect(snippet).toContain('prompt.replaceAll("{{ticket_text}}", String(ticket_text));');
    expect(snippet).toContain('async function run(ticket_text: string, insert_customer_name: string) {');
    expect(balanced(snippet, '(', ')')).toBe(true);
    expect(balanced(snippet, '{', '}')).toBe(true);
  });

  it('substitutes every occurrence of a variable used more than once', () => {
    const template = 'Sell {{product}} to buyers.\n<QA_NOTE>\nSecond mention of {{product}}.\n</QA_NOTE>';
    const variables = buildSnippetVariables(extractPromptPlaceholders(template));
    const snippet = generateTypeScriptSnippet(template, variables);

    // Run the emitted substitution the same way the snippet does. `replace`
    // with a string pattern only hits the first match, leaving the second
    // `{{product}}` in the compiled prompt.
    const line = snippet
      .split('\n')
      .find((l) => l.includes('prompt = prompt.replace'))!;
    const [, method] = line.match(/prompt\.(replace|replaceAll)\(/)!;
    const compiled = (template as string)[method as 'replaceAll']('{{product}}', 'widgets');

    expect(compiled).not.toContain('{{product}}');
  });

  it('handles templates with no variables', () => {
    const snippet = generatePythonSnippet('<GOAL>\nplain text\n</GOAL>', []);

    expect(snippet).toContain('def build_prompt() -> str:');
    expect(snippet).toContain('def run():');
    expect(balanced(snippet, '(', ')')).toBe(true);
  });
});
