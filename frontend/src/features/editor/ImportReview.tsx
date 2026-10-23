'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { fillVariables, renderSections, splitVariables } from '@/lib/sections';
import type { ImportedPrompt, ImportSession, ImportVariable } from './editorState';
import styles from './ImportDialog.module.css';

const VIEWS = [{ value: 'filled', label: 'Filled' }, { value: 'template', label: 'Template' }] as const;

export default function ImportReview({ session, onChange, onImport, onClose }: {
  session: ImportSession;
  onChange: (session: ImportSession) => void;
  onImport: (result: ImportedPrompt) => void;
  onClose: () => void;
}) {
  // Placeholder text such as [TOPIC] comes back with no value, so Filled would show only {{inputs}}.
  const [view, setView] = useState<'filled' | 'template'>(() => session.variables?.some((variable) => variable.value) ? 'filled' : 'template');
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const variables = session.variables ?? [];
  const reusable = variables.filter((variable) => variable.reuse);
  const invalid = reusable.some((variable) => !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(variable.name));
  const duplicate = new Set(reusable.map((variable) => variable.name)).size !== reusable.length;
  const missingFixed = variables.some((variable) => !variable.reuse && !variable.value);
  const nameError = invalid ? 'Variable names must start with a letter or underscore and use letters, numbers, - or _.'
    : duplicate ? 'Variable names must be unique.' : missingFixed ? 'Enter a value before keeping a placeholder fixed.' : '';
  const inputs = Object.fromEntries(reusable.map((variable) => [variable.name, variable.value]));
  const byOriginalName = new Map(variables.map((variable) => [variable.originalName, variable]));
  const fields = session.conversion!.fields.map((field) => ({ ...field,
    content: splitVariables(field.content).map((part) => {
      const variable = part.kind === 'variable' ? byOriginalName.get(part.name!) : undefined;
      return variable ? variable.reuse ? `{{${variable.name}}}` : variable.value : part.text;
    }).join(''),
  }));
  const error = nameError || (fields.some((field) => field.content.length > 10_000)
    ? 'A section exceeds 10,000 characters. Shorten its fixed inputs or keep them as variables.' : '');
  const template = renderSections(fields);
  const filled = fillVariables(template, inputs);
  const unfilled = reusable.some((variable) => !variable.value);
  const copy = async (kind: 'filled' | 'template') => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(kind === 'filled' ? filled : template);
      setCopied(kind === 'template' ? 'Template copied.' : unfilled ? 'Copied with placeholders.' : 'Filled prompt copied.');
    } catch { setCopyError('Copying failed. Select the preview text and copy it instead.'); }
  };
  const changeVariable = (originalName: string, change: Partial<ImportVariable>) => {
    setCopied('');
    onChange({ ...session, variables: variables.map((variable) => variable.originalName === originalName ? { ...variable, ...change } : variable) });
  };

  return <>
    <h3 ref={heading} tabIndex={-1} className={styles.reviewHeading}>Your template is ready to review</h3>
    <p>Original inputs are filled in. Changes here are local; they do not make another AI request.</p>
    <div className={styles.reviewLayout}>
      <section aria-label="Converted prompt" className={styles.preview}>
        <SegmentedControl aria-label="Conversion preview mode" options={VIEWS} value={view} onChange={setView} />
        <pre tabIndex={0} aria-label="Converted prompt preview">{view === 'filled' ? filled : template}</pre>
        {unfilled && <p>Some inputs have no value yet. They stay as placeholders when copied.</p>}
      </section>
      <section aria-label="Detected variables" className={styles.variables}>
        <h3>Detected variables</h3>
        {!variables.length && <p>No changeable inputs were detected. You can still copy the structured prompt or add variables in the editor.</p>}
        {variables.map((variable) => <div className={styles.variable} key={variable.originalName}>
          <label className={styles.reuseToggle}>
            <input type="checkbox" checked={variable.reuse} onChange={(event) => changeVariable(variable.originalName, { reuse: event.target.checked })} />
            Use {variable.originalName} as a variable
          </label>
          {!variable.reuse && <p>This value will stay fixed in the template.</p>}
          <label><span>Variable name</span><input value={variable.name} disabled={!variable.reuse}
            maxLength={100} aria-label={`Variable name for ${variable.originalName}`} aria-invalid={variable.reuse && (invalid || duplicate)}
            onChange={(event) => changeVariable(variable.originalName, { name: event.target.value })} /></label>
          <label><span>Current value</span><textarea value={variable.value} rows={2} maxLength={10_000}
            aria-label={`Value for ${variable.originalName}`} placeholder={variable.description || 'Enter a value'}
            onChange={(event) => changeVariable(variable.originalName, { value: event.target.value })} /></label>
          {variable.source_text === null ? <p>Existing placeholder; the source did not supply a value.</p>
            : <details><summary>Extracted source phrase</summary><blockquote className={styles.sourcePhrase}>{variable.source_text}</blockquote></details>}
        </div>)}
      </section>

    </div>
    {reusable.length > 0 && <label className={styles.reuseToggle}>
      <input type="checkbox" checked={session.keepExamples ?? false} onChange={(event) => onChange({ ...session, keepExamples: event.target.checked })} />
      Keep these inputs as examples
    </label>}
    <p>Current inputs stay in your browser for recovery. Examples are saved with the template only when you choose this option and Save.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {copyError && <p role="alert" className={styles.error}>{copyError}</p>}
    {copied && <p role="status">{copied}</p>}
    <div className={styles.actions}>
      <Button variant="ghost" onClick={onClose}>Close review</Button>
      <Button variant="ghost" onClick={() => onChange({ ...session, reviewing: false })}>Back to source</Button>
      <Button variant="secondary" disabled={!!error} onClick={() => copy('template')}>Copy template</Button>
      <Button variant="secondary" disabled={!!error} onClick={() => copy('filled')}>{unfilled ? 'Copy with placeholders' : 'Copy filled prompt'}</Button>
      <Button variant="primary" disabled={!!error} onClick={() => onImport({ fields, values: inputs,
        metadata: Object.fromEntries(reusable.map((variable) => [variable.name, {
          type: 'text', description: variable.description,
          ...(session.keepExamples && variable.value ? { example: variable.value } : {}),
        }])),
      })}>Use in editor</Button>
    </div>
  </>;
}
