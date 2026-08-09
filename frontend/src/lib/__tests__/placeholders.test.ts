import { describe, expect, it } from 'vitest';
import { compilePrompt, extractPromptPlaceholders } from '../placeholders';

describe('placeholders', () => {
  it('extracts mustache and insert placeholders', () => {
    const placeholders = extractPromptPlaceholders('Hi {{user_name}}, [Insert text]');

    expect(placeholders).toEqual([
      { key: '{{user_name}}', label: 'user_name', token: '{{user_name}}' },
      { key: '[Insert text]', label: 'Insert text', token: '[Insert text]' },
    ]);
  });

  it('compiles supplied values and preserves empty placeholders', () => {
    const prompt = 'Hi {{user_name}}, [Insert text]';

    expect(compilePrompt(prompt, {
      '{{user_name}}': 'Ada',
      '[Insert text]': '',
    })).toBe('Hi Ada, [Insert text]');
  });
});
