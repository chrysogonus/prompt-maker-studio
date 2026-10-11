'use client';

import { useEffect, useRef, useState } from 'react';
import { fillVariables, renderSections, sectionTag, splitVariables } from '@/lib/sections';
import { PromptField, VariableMetadataItem } from '@/types/prompt';
import styles from './PromptEditor.module.css';

// Not a limit of any particular chat app — just a quiet heads-up.
const LONG_PROMPT_CHARS = 40_000;

interface PreviewPaneProps {
  fields: PromptField[];
  variables: string[];
  metadata: Record<string, VariableMetadataItem>;
  values: Record<string, string>;
  onValueChange: (name: string, value: string) => void;
  mode: 'template' | 'filled';
  onModeChange: (mode: 'template' | 'filled') => void;
  open: boolean;
  onToggle: () => void;
  onCopyFailed: () => void;
}

type CopyKind = 'template' | 'filled';

export default function PreviewPane({
  fields,
  variables,
  metadata,
  values,
  onValueChange,
  mode,
  onModeChange,
  open,
  onToggle,
  onCopyFailed,
}: PreviewPaneProps) {
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (!open) {
    return (
      <aside className={styles.previewClosed} aria-label="Preview">
        <button type="button" onClick={onToggle} aria-label="Show preview">
          Preview
        </button>
      </aside>
    );
  }

  const filled = mode === 'filled' && variables.length > 0;
  const template = renderSections(fields);
  const shown = filled ? fillVariables(template, values) : template;
  const unfilled = variables.filter((name) => !values[name]);
  const hasContent = fields.some((field) => field.content.trim());

  const copy = async (kind: CopyKind) => {
    try {
      await navigator.clipboard.writeText(kind === 'filled' ? fillVariables(template, values) : template);
      setCopied(kind);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(null), 1600);
    } catch {
      onCopyFailed();
    }
  };

  const copyKind: CopyKind = filled ? 'filled' : 'template';
  const copyLabel =
    variables.length === 0 ? 'Copy prompt' : filled ? 'Copy filled prompt' : 'Copy template';

  return (
    <aside className={styles.preview} aria-label="Preview">
      <div className={styles.previewHead}>
        <h2>Preview</h2>
        {variables.length > 0 && (
          <div className={styles.modeSwitch} role="radiogroup" aria-label="Preview mode">
            {(['template', 'filled'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => onModeChange(value)}
              >
                {value === 'template' ? 'Template' : 'Filled'}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={styles.previewToggle} onClick={onToggle}>
          Hide
        </button>
      </div>

      {filled && (
        <div className={styles.previewValues}>
          {variables.map((name) => (
            <label key={name} className={styles.valueField}>
              <span>{name}</span>
              <textarea
                value={values[name] ?? ''}
                onChange={(e) => onValueChange(name, e.target.value)}
                placeholder={metadata[name]?.description || 'Type the value'}
                rows={1}
              />
            </label>
          ))}
        </div>
      )}

      <pre className={styles.previewText} tabIndex={0} aria-label="Prompt text">
        {hasContent ? (
          fields.map((field, i) => (
            <span key={i}>
              {i > 0 && '\n\n'}
              <span className={styles.previewTag}>&lt;{sectionTag(field.name)}&gt;</span>
              {'\n'}
              {splitVariables(field.content).map((part, j) => {
                if (part.kind === 'text') return part.text;
                if (!filled) {
                  return (
                    <span key={j} className={styles.previewVariable}>
                      {part.text}
                    </span>
                  );
                }
                return values[part.name!] ? (
                  <mark key={j} className={styles.previewFilled}>
                    {values[part.name!]}
                  </mark>
                ) : (
                  <span key={j} className={styles.previewUnfilled}>
                    {part.text}
                  </span>
                );
              })}
              {'\n'}
              <span className={styles.previewTag}>&lt;/{sectionTag(field.name)}&gt;</span>
            </span>
          ))
        ) : (
          <span className={styles.previewEmpty}>Your prompt appears here as you write.</span>
        )}
      </pre>

      <div className={styles.previewFoot}>
        {shown.length > LONG_PROMPT_CHARS && (
          <p className={styles.previewLong}>
            Long prompt: {shown.length.toLocaleString()} characters.
          </p>
        )}
        {filled && unfilled.length > 0 && (
          <p className={styles.previewWarning}>
            {unfilled.length === 1 ? (
              <>
                <code>{unfilled[0]}</code> is not filled in.
              </>
            ) : (
              `${unfilled.length} variables are not filled in.`
            )}{' '}
            They’ll be copied as placeholders.
          </p>
        )}
        <button
          type="button"
          className={styles.copyButton}
          onClick={() => copy(copyKind)}
          disabled={!hasContent}
        >
          {copied === copyKind ? 'Copied' : copyLabel}
        </button>
      </div>
    </aside>
  );
}
