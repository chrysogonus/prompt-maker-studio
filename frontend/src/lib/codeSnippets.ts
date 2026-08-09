/**
 * Generates ready-to-run OpenAI client boilerplate (Python / TypeScript) from
 * a compiled prompt template and its detected `{{variable}}` placeholders.
 */

import { PromptPlaceholder } from './placeholders';
import { VariableMetadataItem } from '@/types/prompt';

export type SnippetVariableType = VariableMetadataItem['type'];

export interface SnippetVariable {
  paramName: string;
  token: string;
  type: SnippetVariableType;
}

const PY_TYPE_MAP: Record<SnippetVariableType, string> = {
  text: 'str',
  number: 'float',
  boolean: 'bool',
  list: 'list',
};

const TS_TYPE_MAP: Record<SnippetVariableType, string> = {
  text: 'string',
  number: 'number',
  boolean: 'boolean',
  list: 'string[]',
};

const PY_SAMPLE_VALUE: Record<SnippetVariableType, string> = {
  text: '"..."',
  number: '0',
  boolean: 'True',
  list: '[]',
};

const TS_SAMPLE_VALUE: Record<SnippetVariableType, string> = {
  text: "'...'",
  number: '0',
  boolean: 'true',
  list: '[]',
};

function toParamName(label: string, index: number, seen: Set<string>): string {
  let name = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!name || /^[0-9]/.test(name)) {
    name = `var_${name || index}`;
  }

  let unique = name;
  let suffix = 2;
  while (seen.has(unique)) {
    unique = `${name}_${suffix}`;
    suffix += 1;
  }
  seen.add(unique);
  return unique;
}

export function buildSnippetVariables(
  placeholders: PromptPlaceholder[],
  variableMetadata?: Record<string, VariableMetadataItem> | null
): SnippetVariable[] {
  const seen = new Set<string>();
  return placeholders.map((placeholder, index) => ({
    paramName: toParamName(placeholder.label, index, seen),
    token: placeholder.token,
    type: variableMetadata?.[placeholder.label]?.type ?? 'text',
  }));
}

// JSON string-literal escaping (\", \\, \n, ...) is a valid subset of both
// Python's and JS/TS's double-quoted string escaping, so one helper covers both.
function toLiteral(value: string): string {
  return JSON.stringify(value);
}

/**
 * Used when the snippet is generated before the user's connection is known, or
 * for an account with no provider configured. A snippet that names a model the
 * user has not connected is a copy-paste trap, so callers should pass the real
 * one whenever they have it.
 */
export const FALLBACK_SNIPPET_MODEL = 'gpt-4o-mini';

export function generatePythonSnippet(
  template: string,
  variables: SnippetVariable[],
  model: string = FALLBACK_SNIPPET_MODEL,
): string {
  const params = variables.map((v) => `${v.paramName}: ${PY_TYPE_MAP[v.type]}`).join(', ');
  const callArgs = variables.map((v) => `${v.paramName}=${v.paramName}`).join(', ');
  const sampleArgs = variables.map((v) => `${v.paramName}=${PY_SAMPLE_VALUE[v.type]}`).join(', ');

  const buildBodyLines = ['    prompt = PROMPT_TEMPLATE'];
  for (const v of variables) {
    buildBodyLines.push(`    prompt = prompt.replace(${toLiteral(v.token)}, str(${v.paramName}))`);
  }
  buildBodyLines.push('    return prompt');

  return [
    'from openai import OpenAI',
    '',
    'client = OpenAI()',
    '',
    `PROMPT_TEMPLATE = ${toLiteral(template)}`,
    '',
    '',
    `def build_prompt(${params}) -> str:`,
    buildBodyLines.join('\n'),
    '',
    '',
    `def run(${params}):`,
    '    response = client.chat.completions.create(',
    `        model=${toLiteral(model)},`,
    `        messages=[{"role": "user", "content": build_prompt(${callArgs})}],`,
    '    )',
    '    return response.choices[0].message.content',
    '',
    '',
    'if __name__ == "__main__":',
    `    print(run(${sampleArgs}))`,
    '',
  ].join('\n');
}

export function generateTypeScriptSnippet(
  template: string,
  variables: SnippetVariable[],
  model: string = FALLBACK_SNIPPET_MODEL,
): string {
  const params = variables.map((v) => `${v.paramName}: ${TS_TYPE_MAP[v.type]}`).join(', ');
  const callArgs = variables.map((v) => v.paramName).join(', ');
  const sampleArgs = variables.map((v) => TS_SAMPLE_VALUE[v.type]).join(', ');

  const buildBodyLines = ['  let prompt = PROMPT_TEMPLATE;'];
  for (const v of variables) {
    // `replaceAll`, not `replace`: with a string pattern `String.prototype.replace`
    // substitutes only the first match, so a variable used twice in a template
    // would survive into the compiled prompt. Python's `str.replace` is already
    // global, which is why the Python snippet needs no equivalent.
    buildBodyLines.push(`  prompt = prompt.replaceAll(${toLiteral(v.token)}, String(${v.paramName}));`);
  }
  buildBodyLines.push('  return prompt;');

  return [
    "import OpenAI from 'openai';",
    '',
    'const client = new OpenAI();',
    '',
    `const PROMPT_TEMPLATE = ${toLiteral(template)};`,
    '',
    `function buildPrompt(${params}): string {`,
    buildBodyLines.join('\n'),
    '}',
    '',
    `async function run(${params}) {`,
    '  const response = await client.chat.completions.create({',
    `    model: ${toLiteral(model)},`,
    `    messages: [{ role: 'user', content: buildPrompt(${callArgs}) }],`,
    '  });',
    '  return response.choices[0].message.content;',
    '}',
    '',
    `run(${sampleArgs}).then(console.log);`,
    '',
  ].join('\n');
}
