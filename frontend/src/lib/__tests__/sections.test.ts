import { describe, expect, it } from 'vitest';
import renderingCases from '../../../../contracts/section-rendering.json';
import {
  fillVariables,
  normalizeSectionName,
  renderSections,
  sectionNameError,
  sectionTag,
  splitVariables,
  suggestTitle,
  unbalancedTags,
  variablesIn,
} from '../sections';

describe('section names', () => {
  it('collapses whitespace and renders spaces as underscores in the tag', () => {
    expect(normalizeSectionName('  Output \t format ')).toBe('Output format');
    expect(sectionTag('Output format')).toBe('OUTPUT_FORMAT');
    expect(sectionTag('my-style')).toBe('MY-STYLE');
  });

  it('explains what is wrong with a name, or returns null', () => {
    expect(sectionNameError('Role', ['Task'])).toBeNull();
    expect(sectionNameError('   ', [])).toBe('Give this section a name.');
    expect(sectionNameError('2nd pass', [])).toMatch(/Start with a letter/);
    expect(sectionNameError('Tone!', [])).toMatch(/Start with a letter/);
  });

  it('treats names that render to the same tag as duplicates', () => {
    expect(sectionNameError('role', ['Role'])).toMatch(/already becomes <ROLE>/);
    expect(sectionNameError('Output format', ['output_format'])).toMatch(/<OUTPUT_FORMAT>/);
  });
});

describe('renderSections', () => {
  it.each(renderingCases)('preserves the shared contract: $name', ({ sections, rendered }) => {
    expect(renderSections(sections)).toBe(rendered);
  });

  it('matches the server rendering byte for byte', () => {
    expect(
      renderSections([
        { name: 'Role', content: 'You are a tutor.' },
        { name: 'Output format', content: '' },
      ]),
    ).toBe('<ROLE>\nYou are a tutor.\n</ROLE>\n\n<OUTPUT_FORMAT>\n\n</OUTPUT_FORMAT>');
  });
});

describe('variables', () => {
  const sections = [
    { name: 'Task', content: 'Explain {{topic}} to {{ audience }}.' },
    { name: 'Format', content: 'Mention {{topic}} once more.' },
  ];

  it('lists each variable once, in order of first use', () => {
    expect(variablesIn(sections)).toEqual(['topic', 'audience']);
  });

  it('fills what has a value and leaves the rest as placeholders', () => {
    expect(fillVariables('Explain {{topic}} to {{ audience }}.', { topic: 'tides' })).toBe(
      'Explain tides to {{ audience }}.',
    );
  });

  it('splits text into plain runs and variable tokens', () => {
    expect(splitVariables('a {{x}} b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'variable', text: '{{x}}', name: 'x' },
      { kind: 'text', text: ' b' },
    ]);
  });
});

describe('unbalancedTags', () => {
  it('names tags that open and close an uneven number of times', () => {
    expect(unbalancedTags('<b>bold</b> and <i>open')).toEqual(['i']);
    expect(unbalancedTags('</note> stray')).toEqual(['note']);
    expect(unbalancedTags('no tags, {{var}} only')).toEqual([]);
  });
});

describe('suggestTitle', () => {
  it('uses the first line without variables or Markdown markers', () => {
    expect(suggestTitle('  # Review this {{code}} for security.\nMore text')).toBe('Review this for security.');
  });

  it('cuts long lines at a word boundary', () => {
    const title = suggestTitle('Write a detailed weekly status update for the platform team covering risks and blockers');
    expect(title).toBe('Write a detailed weekly status update for the platform team');
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('leaves the name empty when the first line is only a variable', () => {
    expect(suggestTitle('{{draft}}\nPolish this.')).toBe('');
  });
});
