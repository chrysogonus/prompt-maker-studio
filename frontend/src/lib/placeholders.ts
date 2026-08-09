export interface PromptPlaceholder {
  key: string;
  label: string;
  token: string;
}

const MUSTACHE_PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;
const INSERT_PLACEHOLDER = /\[(Insert[^\]]*)\]/g;

export function extractPromptPlaceholders(prompt: string): PromptPlaceholder[] {
  const placeholders = new Map<string, PromptPlaceholder>();

  for (const match of prompt.matchAll(MUSTACHE_PLACEHOLDER)) {
    const token = match[0];
    const label = match[1];
    placeholders.set(token, { key: token, label, token });
  }

  for (const match of prompt.matchAll(INSERT_PLACEHOLDER)) {
    const token = match[0];
    const label = match[1].trim();
    placeholders.set(token, { key: token, label, token });
  }

  return Array.from(placeholders.values());
}

export function compilePrompt(prompt: string, values: Record<string, string>): string {
  return extractPromptPlaceholders(prompt).reduce((compiled, placeholder) => {
    const value = values[placeholder.key]?.trim();
    if (!value) {
      return compiled;
    }

    return compiled.split(placeholder.token).join(value);
  }, prompt);
}
