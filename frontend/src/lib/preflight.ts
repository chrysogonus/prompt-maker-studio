/**
 * Deterministic, advisory-only readiness checks for a prompt template.
 * Shared by the copy action (OutputPanel), the Playground, and the
 * Evaluate tab so authors see the same warnings everywhere, before
 * spending time or a paid model call on a structural mistake. Never
 * blocks the underlying action — see product/BACKLOG.md's "Prompt
 * Preflight & Readiness Checks" gap analysis.
 */

import { extractPromptPlaceholders } from './placeholders';
import { VariableMetadataItem } from '@/types/prompt';

export type PreflightSeverity = 'warning' | 'info';

export interface PreflightWarning {
  id: string;
  message: string;
  severity: PreflightSeverity;
}

export interface PreflightOptions {
  /** Resolved variable values in the current context (e.g. Playground field
   * values). When omitted, only a general placeholder-count note is shown —
   * there's nothing to check "resolved" against. */
  values?: Record<string, string>;
  variableMetadata?: Record<string, VariableMetadataItem> | null;
}

const LARGE_PROMPT_CHAR_THRESHOLD = 40_000;
const TAG_PATTERN = /<(\/?)([A-Za-z_][A-Za-z0-9_-]*)>/g;
const SECTION_PATTERN = /<([A-Za-z_][A-Za-z0-9_-]*)>([\s\S]*?)<\/\1>/g;

function checkUnresolvedPlaceholders(
  template: string,
  values: Record<string, string> | undefined,
  variableMetadata: Record<string, VariableMetadataItem> | null | undefined
): PreflightWarning[] {
  const placeholders = extractPromptPlaceholders(template);
  if (placeholders.length === 0) return [];

  if (!values) {
    const labels = placeholders.map((p) => p.label).join(', ');
    return [
      {
        id: 'unresolved-placeholders',
        message: `${placeholders.length} variable${placeholders.length === 1 ? '' : 's'} (${labels}) will remain in the output unless resolved before use.`,
        severity: 'info',
      },
    ];
  }

  // A boolean variable is never "missing": both states of its control are a
  // real value, and an untouched toggle means `false`. Treating the empty
  // initial state as unset made `false` unreachable without toggling twice.
  const unresolved = placeholders.filter(
    (p) => variableMetadata?.[p.label]?.type !== 'boolean' && !values[p.label]?.trim()
  );
  if (unresolved.length === 0) return [];
  return [
    {
      id: 'unresolved-placeholders',
      message: `Missing a value for ${unresolved.map((p) => p.label).join(', ')}.`,
      severity: 'warning',
    },
  ];
}

function checkMalformedXml(template: string): PreflightWarning[] {
  const counts = new Map<string, { open: number; close: number }>();
  for (const match of template.matchAll(TAG_PATTERN)) {
    const [, closing, name] = match;
    const entry = counts.get(name) ?? { open: 0, close: 0 };
    if (closing) entry.close += 1;
    else entry.open += 1;
    counts.set(name, entry);
  }

  const warnings: PreflightWarning[] = [];
  for (const [name, { open, close }] of counts) {
    if (open !== close) {
      warnings.push({
        id: `xml-unbalanced-${name}`,
        message: `<${name}> has ${open} opening tag${open === 1 ? '' : 's'} but ${close} closing tag${close === 1 ? '' : 's'} — check for a missing or extra tag.`,
        severity: 'warning',
      });
    }
  }
  return warnings;
}

function checkEmptySections(template: string): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];
  for (const match of template.matchAll(SECTION_PATTERN)) {
    const [, name, content] = match;
    if (!content.trim()) {
      warnings.push({
        id: `empty-section-${name}-${match.index}`,
        message: `<${name}> section is empty.`,
        severity: 'info',
      });
    }
  }
  return warnings;
}

function checkStaleVariableMetadata(
  template: string,
  variableMetadata: Record<string, VariableMetadataItem> | null | undefined
): PreflightWarning[] {
  if (!variableMetadata) return [];
  const currentLabels = new Set(extractPromptPlaceholders(template).map((p) => p.label));
  const stale = Object.keys(variableMetadata).filter((name) => !currentLabels.has(name));
  if (stale.length === 0) return [];
  return [
    {
      id: 'stale-variable-metadata',
      message: `Variable metadata exists for ${stale.join(', ')}, which no longer appear${stale.length === 1 ? 's' : ''} in the template.`,
      severity: 'info',
    },
  ];
}

function checkPromptSize(template: string): PreflightWarning[] {
  if (template.length <= LARGE_PROMPT_CHAR_THRESHOLD) return [];
  const estimatedTokens = Math.ceil(template.length / 4);
  return [
    {
      id: 'large-prompt',
      message: `This template is ~${estimatedTokens.toLocaleString()} tokens — large prompts may exceed some models' context limits or cost more per run.`,
      severity: 'info',
    },
  ];
}

export function runPreflightChecks(
  template: string,
  options: PreflightOptions = {}
): PreflightWarning[] {
  if (!template.trim()) return [];
  return [
    ...checkUnresolvedPlaceholders(template, options.values, options.variableMetadata),
    ...checkMalformedXml(template),
    ...checkEmptySections(template),
    ...checkStaleVariableMetadata(template, options.variableMetadata),
    ...checkPromptSize(template),
  ];
}
