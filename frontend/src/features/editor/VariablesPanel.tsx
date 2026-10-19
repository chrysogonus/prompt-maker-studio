'use client';

import Button from '@/components/ui/Button';
import Link from 'next/link';
import { VariableMetadataItem } from '@/types/prompt';
import styles from './PromptEditor.module.css';

interface VariablesPanelProps {
  variables: string[];
  metadata: Record<string, VariableMetadataItem>;
  onDescribe: (name: string, description: string) => void;
  onChangeMetadata: (name: string, change: Partial<VariableMetadataItem>) => void;
  onRemove: (name: string) => void;
}

export default function VariablesPanel({
  variables,
  metadata,
  onDescribe,
  onChangeMetadata,
  onRemove,
}: VariablesPanelProps) {
  // A hint outlives its variable until removed, so renaming {{tone}} to
  // {{voice}} by accident doesn't silently throw the hint away.
  const stale = Object.keys(metadata).filter(
    (name) => !variables.includes(name),
  );

  return (
    <section className={styles.variables} aria-labelledby="variables-heading">
      <h2 id="variables-heading">Variables</h2>
      {variables.length === 0 && stale.length === 0 ? (
        <p className={styles.variablesIntro}>
          Put the parts that change in double braces, like <code>{'{{audience}}'}</code>. They
          become fields you fill in before copying.{' '}
          <Link href="/guides/prompt-template-variables">Learn about variables</Link>
        </p>
      ) : (
        <p className={styles.variablesIntro}>Hints appear when you fill the prompt in. Required inputs and examples are optional settings; save to keep them.</p>
      )}
      {variables.map((name) => (
        <div key={name} className={styles.variableRow}>
          <code className={styles.variableName} title={name}>
            {name}
          </code>
          <input
            value={metadata[name]?.description ?? ''}
            onChange={(e) => onDescribe(name, e.target.value)}
            placeholder="Add a hint (optional)"
            aria-label={`Hint for ${name}`}
            maxLength={500}
          />
          <details className={styles.variableAdvanced}>
            <summary>Options for {name}</summary>
            <div className={styles.variableOptions}>
            <label><input type="checkbox" checked={metadata[name]?.required ?? false}
              onChange={(event) => onChangeMetadata(name, { required: event.target.checked })} />
              Required {name}
            </label>
            <textarea value={metadata[name]?.example ?? ''} maxLength={10_000} rows={2}
              aria-label={`Example input for ${name}`} placeholder="Example input (loaded only when requested)"
              onChange={(event) => onChangeMetadata(name, { example: event.target.value || null })} />
            </div>
          </details>
        </div>
      ))}
      {stale.map((name) => (
        <div key={name} className={styles.variableRow} data-stale="true">
          <code className={styles.variableName}>{name}</code>
          <span className={styles.staleNote}>
            No longer used in this prompt. Its settings are kept until you remove them.
          </span>
          <Button variant="ghost" onClick={() => onRemove(name)}>
            Remove
          </Button>
        </div>
      ))}
    </section>
  );
}
