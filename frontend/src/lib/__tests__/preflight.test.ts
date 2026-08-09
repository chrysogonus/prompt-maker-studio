import { describe, it, expect } from 'vitest';
import { runPreflightChecks } from '../preflight';

describe('runPreflightChecks', () => {
  it('returns no warnings for an empty template', () => {
    expect(runPreflightChecks('')).toEqual([]);
  });

  it('returns no warnings for a well-formed template with no variables', () => {
    const template = '<GOAL>\nDo the thing.\n</GOAL>';
    expect(runPreflightChecks(template)).toEqual([]);
  });

  it('notes unresolved placeholders when no values are given', () => {
    const warnings = runPreflightChecks('Say {{thing}} to {{person}}');
    const warning = warnings.find((w) => w.id === 'unresolved-placeholders');
    expect(warning?.severity).toBe('info');
    expect(warning?.message).toContain('thing');
    expect(warning?.message).toContain('person');
  });

  it('warns about missing values when values are given but incomplete', () => {
    const warnings = runPreflightChecks('Say {{thing}} to {{person}}', {
      values: { thing: 'hello', person: '' },
    });
    const warning = warnings.find((w) => w.id === 'unresolved-placeholders');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('person');
    expect(warning?.message).not.toContain('thing');
  });

  it('has no unresolved-placeholder warning when all values are filled', () => {
    const warnings = runPreflightChecks('Say {{thing}}', { values: { thing: 'hello' } });
    expect(warnings.find((w) => w.id === 'unresolved-placeholders')).toBeUndefined();
  });

  it('never reports a Boolean variable as missing a value', () => {
    // An untouched toggle sits at off, which is a real `false`, not "unset" —
    // treating it as missing made `false` unreachable as an initial state.
    const warnings = runPreflightChecks('Urgent? {{is_urgent}}', {
      values: {},
      variableMetadata: { is_urgent: { type: 'boolean', description: null } },
    });
    expect(warnings.find((w) => w.id === 'unresolved-placeholders')).toBeUndefined();
  });

  it('still reports non-Boolean variables as missing alongside a Boolean one', () => {
    const warnings = runPreflightChecks('{{is_urgent}} {{ticket}}', {
      values: {},
      variableMetadata: { is_urgent: { type: 'boolean', description: null } },
    });
    const warning = warnings.find((w) => w.id === 'unresolved-placeholders');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('ticket');
    expect(warning?.message).not.toContain('is_urgent');
  });

  it('flags unbalanced XML tags', () => {
    const warnings = runPreflightChecks('<GOAL>Do the thing.');
    const warning = warnings.find((w) => w.id === 'xml-unbalanced-GOAL');
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('does not flag balanced XML tags', () => {
    const warnings = runPreflightChecks('<GOAL>Do the thing.</GOAL>');
    expect(warnings.some((w) => w.id.startsWith('xml-unbalanced'))).toBe(false);
  });

  it('flags an empty section', () => {
    const warnings = runPreflightChecks('<GOAL></GOAL>\n<CONTEXT>Some context.</CONTEXT>');
    expect(warnings.some((w) => w.message.includes('<GOAL> section is empty'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('<CONTEXT> section is empty'))).toBe(false);
  });

  it('flags stale variable metadata for a variable no longer in the template', () => {
    const warnings = runPreflightChecks('Say {{thing}}', {
      variableMetadata: { thing: { type: 'text' }, ghost: { type: 'text' } },
    });
    const warning = warnings.find((w) => w.id === 'stale-variable-metadata');
    expect(warning?.message).toContain('ghost');
    expect(warning?.message).not.toContain('thing,');
  });

  it('does not flag variable metadata that matches current placeholders', () => {
    const warnings = runPreflightChecks('Say {{thing}}', {
      variableMetadata: { thing: { type: 'text' } },
    });
    expect(warnings.find((w) => w.id === 'stale-variable-metadata')).toBeUndefined();
  });

  it('flags a very large template', () => {
    const warnings = runPreflightChecks('a'.repeat(50_000));
    expect(warnings.find((w) => w.id === 'large-prompt')).toBeDefined();
  });

  it('does not flag a normally sized template', () => {
    const warnings = runPreflightChecks('A short prompt.');
    expect(warnings.find((w) => w.id === 'large-prompt')).toBeUndefined();
  });
});
