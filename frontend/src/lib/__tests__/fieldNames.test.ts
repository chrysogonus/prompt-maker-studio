import { describe, expect, it } from 'vitest';
import { hasDuplicateFieldNames, sanitizeFieldName } from '../fieldNames';

describe('fieldNames', () => {
  it('sanitizes spaces and special characters into XML-safe names', () => {
    expect(sanitizeFieldName('user name!')).toBe('user_name');
    expect(sanitizeFieldName('123 goal')).toBe('field_123_goal');
    expect(sanitizeFieldName('<tone>')).toBe('tone');
  });

  it('detects duplicate filled names', () => {
    expect(hasDuplicateFieldNames(['goal', 'style', 'goal'])).toBe(true);
    expect(hasDuplicateFieldNames(['goal', '', 'style'])).toBe(false);
  });

  it('treats case-variant names as duplicates, since both upper-case to one tag', () => {
    expect(hasDuplicateFieldNames(['QA_dup', 'qa_DUP'])).toBe(true);
    expect(hasDuplicateFieldNames(['goal', 'GOAL', 'style'])).toBe(true);
  });
});
