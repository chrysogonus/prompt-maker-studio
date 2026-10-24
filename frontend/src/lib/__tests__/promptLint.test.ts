import { describe, expect, it } from 'vitest';
import { lintPrompt } from '../promptLint';

const ids = (text: string) => lintPrompt(text).map((finding) => finding.id);

describe('lintPrompt', () => {
  it('finds nothing in an empty prompt', () => {
    expect(lintPrompt('   ')).toEqual([]);
  });

  it('suggests the parts a vague prompt leaves out', () => {
    expect(ids('Summarize this article about {{topic}}.')).toEqual(['no-audience', 'no-format', 'no-length', 'no-example']);
  });

  it('accepts a prompt that states role, format, length and an example', () => {
    expect(ids('You are an editor. Summarize {{topic}} in at most five bullets. For example: "Decision: ship in May."')).toEqual([]);
  });

  it('reports broken variables and tags as problems', () => {
    const findings = lintPrompt('You are a tutor. Explain {{project name}} and {{Topic}} vs {{topic}} in <context>three bullets</contxt>, e.g. one line each.');
    expect(findings.filter((finding) => finding.severity === 'problem').map((finding) => finding.id))
      .toEqual(['invalid-variable', 'variable-case', 'unbalanced-tags']);
    expect(findings.find((finding) => finding.id === 'invalid-variable')!.message).toContain('{{project name}}');
    expect(findings.find((finding) => finding.id === 'variable-case')!.message).toContain('Topic / topic');
  });

  it('reports half-written placeholders', () => {
    const complete = 'You are a tutor. Give a short list, for example a summary of ';
    expect(ids(`${complete}{{topic.`)).toEqual(['unclosed-variable']);
    expect(lintPrompt(`${complete}{{topic.`)[0].message).toContain('closing }}');
    expect(lintPrompt(`${complete}topic}}.`)[0].message).toContain('opening {{');
    expect(ids(`${complete}{{topic}}.`)).toEqual([]);
  });

  it('asks for sections only in long prompts without any', () => {
    const long = `You are a writer. Write a short list, for example a recipe. ${'More detail. '.repeat(120)}`;
    expect(ids(long)).toContain('no-sections');
    expect(ids(`<task>${long}</task>`)).not.toContain('no-sections');
    expect(ids(`# Task\n${long}`)).not.toContain('no-sections');
  });
});
