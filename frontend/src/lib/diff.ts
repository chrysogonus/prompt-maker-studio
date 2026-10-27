/**
 * Word-level diff between two strings, for the Refine tab's draft-vs-current
 * comparison. Classic LCS-based diff over whitespace-delimited tokens —
 * Long comparisons fall back to complete replacements to bound memory use.
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
  if (oldText === newText) return oldText ? [{ type: 'unchanged', text: oldText }] : [];
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  const m = oldTokens.length;
  const n = newTokens.length;

  // ponytail: cap LCS at one million cells; show complete text above that size.
  if ((m + 1) * (n + 1) > 1_000_000) {
    return [
      ...(oldText ? [{ type: 'removed' as const, text: oldText }] : []),
      ...(newText ? [{ type: 'added' as const, text: newText }] : []),
    ];
  }

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

  // One token per run, spaces included: "tailored to" is one insertion, not three, and no
  // change is a lone space that a screen reader announces as an empty insertion.
  return result.reduce<DiffToken[]>((runs, token) => {
    const last = runs.at(-1);
    if (last?.type === token.type) last.text += token.text;
    else runs.push({ ...token });
    return runs;
  }, []);
}
