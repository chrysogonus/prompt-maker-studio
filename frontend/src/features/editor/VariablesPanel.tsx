'use client';

import Button from '@/components/ui/Button';
import { VariableMetadataItem } from '@/types/prompt';
import styles from './PromptEditor.module.css';

interface VariablesPanelProps {
  variables: string[];
  metadata: Record<string, VariableMetadataItem>;
  onDescribe: (name: string, description: string) => void;
  onRemove: (name: string) => void;
}

export default function VariablesPanel({
  variables,
  metadata,
  onDescribe,
  onRemove,
}: VariablesPanelProps) {
  // A hint outlives its variable until removed, so renaming {{tone}} to
  // {{voice}} by accident doesn't silently throw the hint away.
  const stale = Object.keys(metadata).filter(
    (name) => !variables.includes(name) && metadata[name]?.description,
  );

  return (
    <section className={styles.variables} aria-labelledby="variables-heading">
      <h2 id="variables-heading">Variables</h2>
      {variables.length === 0 && stale.length === 0 ? (
        <p className={styles.variablesIntro}>
          Put the parts that change in double braces, like <code>{'{{audience}}'}</code>. They
          become fields you fill in before copying.
        </p>
      ) : (
        <p className={styles.variablesIntro}>Hints appear when you fill the prompt in.</p>
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
        </div>
      ))}
      {stale.map((name) => (
        <div key={name} className={styles.variableRow} data-stale="true">
          <code className={styles.variableName}>{name}</code>
          <span className={styles.staleNote}>
            No longer used in this prompt. Its hint is kept until you remove it.
          </span>
          <Button variant="ghost" onClick={() => onRemove(name)}>
            Remove
          </Button>
        </div>
      ))}
    </section>
  );
}
