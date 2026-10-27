import { describe, expect, it } from 'vitest';
import { diffWords } from '../diff';

describe('diffWords', () => {
  it('compares long sections as complete replacements while preserving both texts', () => {
    const oldText = 'old '.repeat(1000);
    const newText = 'new '.repeat(1000);
    expect(diffWords(oldText, newText)).toEqual([
      { type: 'removed', text: oldText },
      { type: 'added', text: newText },
    ]);
  });

  it('returns long identical text unchanged without computing a comparison matrix', () => {
    const text = 'same '.repeat(1000);
    expect(diffWords(text, text)).toEqual([{ type: 'unchanged', text }]);
  });

  it('returns all unchanged tokens for identical strings', () => {
    const result = diffWords('hello world', 'hello world');
    expect(result.every((t) => t.type === 'unchanged')).toBe(true);
    expect(result.map((t) => t.text).join('')).toBe('hello world');
  });

  it('detects an added word', () => {
    const result = diffWords('hello world', 'hello brave world');
    const added = result.filter((t) => t.type === 'added').map((t) => t.text.trim());
    expect(added).toContain('brave');
  });

  it('detects a removed word', () => {
    const result = diffWords('hello brave world', 'hello world');
    const removed = result.filter((t) => t.type === 'removed').map((t) => t.text.trim());
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
    const placeholderTokens = result.filter((token) => token.text.includes('{{audience}}'));

    expect(placeholderTokens).toHaveLength(1);
    expect(placeholderTokens[0].type).toBe('unchanged');
  });

  it.each([
    ['Suggest a trip for {{city}} now.', 'Suggest a trip tailored to {{city}} now.'],
    ['hello world', 'hello brave world'],
    ['a few bullets', 'at most five bullets'],
  ])('never marks a lone space as a change, and rebuilds both texts: %s', (oldText, newText) => {
    const result = diffWords(oldText, newText);
    expect(result.filter((t) => t.type !== 'unchanged' && !t.text.trim())).toEqual([]);
    // Runs of the same kind are merged, so neighbours always differ.
    expect(result.every((t, i) => i === 0 || t.type !== result[i - 1].type)).toBe(true);
    expect(result.filter((t) => t.type !== 'added').map((t) => t.text).join('')).toBe(oldText);
    expect(result.filter((t) => t.type !== 'removed').map((t) => t.text).join('')).toBe(newText);
  });
});
