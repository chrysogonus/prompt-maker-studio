/**
 * Word-level diff between two strings, for the Refine tab's draft-vs-current
 * comparison. Classic LCS-based diff over whitespace-delimited tokens —
 * simple and adequate for prompt-length text.
 */

export interface DiffToken {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

function tokenize(text: string): string[] {
  // Capturing groups keep whitespace and {{variable}} placeholders as
  // standalone tokens. Placeholders then act as stable LCS anchors instead
  // of being deleted/reinserted when adjacent prose or punctuation changes.
  return text.split(/(\s+|\{\{[^{}]+\}\})/).filter((token) => token.length > 0);
}

export function diffWords(oldText: string, newText: string): DiffToken[] {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  const m = oldTokens.length;
  const n = newTokens.length;

  // lcs[i][j] = length of the longest common subsequence of
  // oldTokens[i:] and newTokens[j:]
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] =
        oldTokens[i] === newTokens[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldTokens[i] === newTokens[j]) {
      result.push({ type: 'unchanged', text: oldTokens[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'removed', text: oldTokens[i] });
      i++;
    } else {
      result.push({ type: 'added', text: newTokens[j] });
      j++;
    }
  }
  while (i < m) {
    result.push({ type: 'removed', text: oldTokens[i] });
    i++;
  }
  while (j < n) {
    result.push({ type: 'added', text: newTokens[j] });
    j++;
  }

  return result;
}
