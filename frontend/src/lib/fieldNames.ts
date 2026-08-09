const VALID_START = /^[A-Za-z_]$/;
const VALID_BODY = /^[A-Za-z0-9_-]$/;

export function sanitizeFieldName(value: string): string {
  const normalized = value.replace(/\s+/g, '_');
  let sanitized = '';

  for (const char of normalized) {
    if (VALID_BODY.test(char)) {
      sanitized += char;
    }
  }

  if (!sanitized) {
    return '';
  }

  if (!VALID_START.test(sanitized[0])) {
    return `field_${sanitized}`;
  }

  return sanitized;
}

export function hasDuplicateFieldNames(names: string[]): boolean {
  // Compared case-insensitively because the generator upper-cases every field
  // name into its XML tag (`PromptGeneratorService.generate`), so `QA_dup` and
  // `qa_DUP` both become `<QA_DUP>` — two identical blocks in one prompt.
  const filledNames = names.filter(Boolean).map((name) => name.toUpperCase());
  return new Set(filledNames).size !== filledNames.length;
}
