/**
 * Rule-based checks for a pasted prompt, run in the browser. They look for the
 * parts a good prompt usually states; each is a heuristic, so findings are
 * suggestions rather than errors, except for broken syntax.
 */

import { isVariableName, unbalancedTags } from './sections';

export interface LintFinding {
  id: string;
  severity: 'problem' | 'suggestion';
  message: string;
  fix: string;
}

// Any double-brace token, valid name or not, so broken placeholders are caught.
const BRACES = /\{\{([^{}]*)\}\}/g;
const LONG_WITHOUT_SECTIONS = 1200;

const HINTS = {
  format: /\b(format|bullet|bullets|list|table|json|markdown|heading|headings|section|sections|paragraph|paragraphs|steps|outline|template|structure|csv|yaml)\b/i,
  length: /\b(\d+\s*(words?|sentences?|paragraphs?|bullets?|lines?|characters?|items?|points?|pages?)|short|brief|concise|under|at most|no more than|maximum|max\.?|limit|one-liner|tl;dr)\b/i,
  audience: /\b(you are|act as|as an? |audience|reader|readers|for (a|an|my|our|the)\b|beginner|beginners|expert|experts|customer|customers|stakeholder|stakeholders|team|student|students)\b/i,
  example: /\b(for example|e\.g\.|example|examples|such as|like this|sample|input:|output:)\b/i,
};

export function lintPrompt(text: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const trimmed = text.trim();
  if (!trimmed) return findings;

  const names = [...trimmed.matchAll(BRACES)].map((match) => match[1].trim());
  const invalid = [...new Set(names.filter((name) => !isVariableName(name)))];
  if (invalid.length) {
    findings.push({
      id: 'invalid-variable', severity: 'problem',
      message: `Not a valid variable name: ${invalid.map((name) => `{{${name}}}`).join(', ')}.`,
      fix: 'Use letters, numbers, _ or -, starting with a letter or underscore, such as {{project_name}}.',
    });
  }
  const valid = [...new Set(names.filter(isVariableName))];
  const byLower = new Map<string, string[]>();
  for (const name of valid) byLower.set(name.toLowerCase(), [...(byLower.get(name.toLowerCase()) ?? []), name]);
  const clashes = [...byLower.values()].filter((group) => group.length > 1);
  if (clashes.length) {
    findings.push({
      id: 'variable-case', severity: 'problem',
      message: `These variables differ only in capitalization: ${clashes.map((group) => group.join(' / ')).join('; ')}.`,
      fix: 'Pick one spelling so the same detail is asked for once.',
    });
  }
  // Whatever is left once complete {{…}} pairs are removed is a half-written placeholder.
  const stray = trimmed.replace(BRACES, '').match(/\{\{|\}\}/g);
  if (stray) {
    findings.push({
      id: 'unclosed-variable', severity: 'problem',
      message: `A placeholder is missing its ${stray.includes('{{') ? 'closing }}' : 'opening {{'}.`,
      fix: 'Write each variable as a complete pair, such as {{topic}}.',
    });
  }
  const tags = unbalancedTags(trimmed);
  if (tags.length) {
    findings.push({
      id: 'unbalanced-tags', severity: 'problem',
      message: `Opening and closing tags do not match: ${tags.map((tag) => `<${tag}>`).join(', ')}.`,
      fix: 'Close every tag you open, such as <context> … </context>, or remove the stray one.',
    });
  }
  if (!HINTS.audience.test(trimmed)) {
    findings.push({
      id: 'no-audience', severity: 'suggestion',
      message: 'It does not say who the answer is for or what role the model should take.',
      fix: 'Add a line such as "You are a patient tutor" or "Write for busy managers".',
    });
  }
  if (!HINTS.format.test(trimmed)) {
    findings.push({
      id: 'no-format', severity: 'suggestion',
      message: 'It does not describe the shape of the answer.',
      fix: 'Say what you want back: a table, three bullets, JSON with given keys, or headings.',
    });
  }
  if (!HINTS.length.test(trimmed)) {
    findings.push({
      id: 'no-length', severity: 'suggestion',
      message: 'It sets no length or limit.',
      fix: 'Add a limit such as "under 150 words" or "at most five bullets".',
    });
  }
  if (!HINTS.example.test(trimmed)) {
    findings.push({
      id: 'no-example', severity: 'suggestion',
      message: 'It gives no example of a good answer or input.',
      fix: 'One short example of the output you want often helps more than more instructions.',
    });
  }
  if (trimmed.length > LONG_WITHOUT_SECTIONS && !/<[A-Za-z_][\w-]*>|^#{1,6}\s/m.test(trimmed)) {
    findings.push({
      id: 'no-sections', severity: 'suggestion',
      message: 'It is long and has no sections.',
      fix: 'Split it into labelled parts, such as Role, Context, Task and Format, or use <tags>.',
    });
  }
  return findings;
}
