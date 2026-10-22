'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { openInApp } from '@/lib/openInApp';
import { fillVariables, renderSections, valueFor, variablesIn } from '@/lib/sections';
import type { PromptField } from '@/types/prompt';
import styles from '@/components/public/Tools.module.css';

/**
 * Fill in a template's {{variables}} and copy the result. Editable for the
 * template-filler tool; given fixed sections for a gallery template.
 */
export default function TemplateFiller({ initialText = '', fields, title, hints = {}, examples = {} }: {
  initialText?: string;
  fields?: PromptField[];
  title?: string;
  hints?: Record<string, string>;
  examples?: Record<string, string>;
}) {
  const [text, setText] = useState(initialText);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const template = fields ? renderSections(fields) : text;
  const names = variablesIn([{ name: 'Prompt', content: template }]);
  const filled = fillVariables(template, values);
  const unfilled = names.filter((name) => !valueFor(values, name)?.trim()).length;
  const exampleValues = Object.fromEntries(names.flatMap((name) => {
    const example = valueFor(examples, name);
    return example ? [[name, example]] : [];
  }));
  const hasExamples = Object.keys(exampleValues).length > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(filled);
      setStatus(unfilled ? `Copied with ${unfilled} unfilled ${unfilled === 1 ? 'placeholder' : 'placeholders'}.` : 'Filled prompt copied.');
    } catch {
      setStatus('Copying failed. Select the text below and copy it.');
    }
  };

  return (
    <>
      {!fields && (
        <div className={styles.field}>
          <label htmlFor="filler-template">Prompt template</label>
          <textarea id="filler-template" className={styles.textarea} value={text} onChange={(event) => { setText(event.target.value); setStatus(''); }}
            placeholder="Write a weekly update for {{team}} using these notes: {{notes}}" maxLength={50_000} aria-describedby="filler-template-hint" />
          <small id="filler-template-hint">Put the parts that change in double braces, such as {'{{audience}}'}.</small>
        </div>
      )}
      {names.length > 0 ? (
        <fieldset className={styles.field}>
          <legend>Fill in</legend>
          {hasExamples && (
            <div className={styles.actions}>
              <Button variant="ghost" onClick={() => setValues({ ...values, ...exampleValues })}>Use example inputs</Button>
            </div>
          )}
          {names.map((name) => (
            <label key={name} className={styles.field}>
              <code>{name}</code>
              {/* Multiline: inputs are often pasted notes, sources or code. */}
              <textarea className={`${styles.textarea} ${styles.short}`} value={valueFor(values, name) ?? ''} placeholder={valueFor(hints, name) || 'Type the value'}
                onChange={(event) => { setValues({ ...values, [name]: event.target.value }); setStatus(''); }} maxLength={50_000} />
            </label>
          ))}
        </fieldset>
      ) : (
        <p className={styles.status}>{template.trim() ? 'No {{variables}} found yet. Add some to get a field for each.' : 'Paste or type a prompt above to begin.'}</p>
      )}
      {template.trim() && (
        <>
          <pre className={styles.output} aria-label="Filled prompt" tabIndex={0}>{filled}</pre>
          <div className={styles.actions}>
            <Button variant="primary" onClick={copy}>Copy prompt</Button>
            <Button onClick={() => openInApp({ title, fields: fields ?? [{ name: 'Task', content: text }], values, hints })}>
              Save to my library
            </Button>
            <span role="status" className={styles.status}>{status}</span>
          </div>
        </>
      )}
    </>
  );
}
