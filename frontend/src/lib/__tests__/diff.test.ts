import { describe, expect, it } from 'vitest';
import { diffWords } from '../diff';

describe('diffWords', () => {
  it('returns all unchanged tokens for identical strings', () => {
    const result = diffWords('hello world', 'hello world');
    expect(result.every((t) => t.type === 'unchanged')).toBe(true);
    expect(result.map((t) => t.text).join('')).toBe('hello world');
  });

  it('detects an added word', () => {
    const result = diffWords('hello world', 'hello brave world');
    const added = result.filter((t) => t.type === 'added').map((t) => t.text);
    expect(added).toContain('brave');
  });

  it('detects a removed word', () => {
    const result = diffWords('hello brave world', 'hello world');
    const removed = result.filter((t) => t.type === 'removed').map((t) => t.text);
    expect(removed).toContain('brave');
  });

  it('handles empty strings', () => {
    expect(diffWords('', '')).toEqual([]);
    expect(diffWords('', 'new text').every((t) => t.type === 'added')).toBe(true);
    expect(diffWords('old text', '').every((t) => t.type === 'removed')).toBe(true);
  });

  it('preserves whitespace as unchanged when surrounding words are unchanged', () => {
    const result = diffWords('a  b', 'a  b');
    expect(result.every((t) => t.type === 'unchanged')).toBe(true);
  });

  it('reconstructs the new text by concatenating unchanged and added tokens', () => {
    const newText = 'hello brave new world';
    const result = diffWords('hello world', newText);
    const reconstructed = result
      .filter((t) => t.type !== 'removed')
      .map((t) => t.text)
      .join('');
    expect(reconstructed).toBe(newText);
  });

  it('keeps unchanged variable placeholders as stable anchors', () => {
    const result = diffWords(
      'Write for {{audience}}.',
      'Write a persuasive description for {{audience}} today.',
    );
    const placeholderTokens = result.filter((token) => token.text === '{{audience}}');

    expect(placeholderTokens).toEqual([{ type: 'unchanged', text: '{{audience}}' }]);
  });
});
