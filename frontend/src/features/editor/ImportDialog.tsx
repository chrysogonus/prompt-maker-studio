'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import AICallContext from '@/components/ui/AICallContext';
import Dialog from '@/components/ui/Dialog';
import { ApiClient } from '@/lib/api';
import { variablesIn } from '@/lib/sections';
import type { PromptsConfigResponse } from '@/types/prompt';
import type { ImportedPrompt, ImportSession } from './editorState';
import ImportReview from './ImportReview';
import styles from './PromptEditor.module.css';
import importStyles from './ImportDialog.module.css';

interface ImportDialogProps {
  isOpen: boolean;
  aiAvailable: boolean;
  aiConfig: PromptsConfigResponse | null;
  replacesContent: boolean;
  session: ImportSession;
  onSessionChange: (session: ImportSession) => void;
  onClose: () => void;
  onImport: (result: ImportedPrompt) => void;
}

export default function ImportDialog({
  isOpen, aiAvailable, aiConfig, replacesContent, session, onSessionChange, onClose, onImport,
}: ImportDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session.text.trim() || busyRef.current || !aiAvailable) return;
    const id = ++request.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await ApiClient.parsePromptText({ text: session.text, extract_variables: true });
      if (id !== request.current) return;
      const variables = result.variables ?? variablesIn(result.fields).map((name) => ({ name, value: '', description: '', source_text: null }));
      onSessionChange({ ...session, conversion: result, reviewing: true, keepExamples: false,
        variables: variables.map((variable) => ({ ...variable, originalName: variable.name, reuse: true })),
      });
    } catch (failure) {
      if (id === request.current) setError(failure instanceof Error ? failure.message : 'Conversion failed. Please try again.');
    } finally {
      if (id === request.current) { busyRef.current = false; setBusy(false); }
    }
  };

  if (!aiAvailable && !session.conversion) {
    return <Dialog isOpen={isOpen} title={aiConfig?.budget_exhausted ? 'AI budget reached' : 'Paste a prompt needs an AI connection'} onClose={onClose}>
      <AICallContext config={aiConfig} />
      <p className={styles.dialogText}>Paste a prompt uses AI to turn unstructured text into XML-style sections and suggest reusable variables. You can always write sections by hand.</p>
      <div className={styles.dialogActions}>
        <Button variant="ghost" onClick={onClose}>Not now</Button>
        <Link className={styles.buttonLink} href="/settings#s-api">Open Settings</Link>
      </div>
    </Dialog>;
  }

  return <Dialog isOpen={isOpen} title={session.reviewing ? 'Review your template' : 'Paste a prompt'}
    className={importStyles.dialog} onClose={() => !busyRef.current && onClose()}>
    {session.reviewing && session.conversion ? <>
      {replacesContent && <p className={styles.dialogHint}>Use in editor will replace your current sections and variable settings in the draft. Undo restores the previous draft. Save to keep the conversion.</p>}
      <ImportReview session={session} onChange={onSessionChange} onImport={onImport} onClose={onClose} />
    </> : <form className={styles.dialogForm} onSubmit={submit}>
      <p className={styles.dialogText}>Paste a prompt you already use. Create a reusable XML-style template with its original inputs filled in, then review before copying or applying.</p>
      <AICallContext config={aiConfig} />
      <textarea className={styles.importText} value={session.text}
        onChange={(event) => { onSessionChange({ text: event.target.value }); setError(''); }}
        placeholder="For example: Plan a 3-day trip to Lisbon for 2 adults with a budget of €900. Give me a daily itinerary."
        aria-label="Prompt to convert" maxLength={10_000} disabled={busy} autoFocus />
      {replacesContent && <small className={styles.dialogHint}>Conversion starts a review. Your current draft stays as it is until you choose Use in editor.</small>}
      {error && <p className={styles.formError} role="alert">{error}</p>}
      {busy && <p role="status">Creating sections and identifying reusable inputs…</p>}
      <div className={styles.dialogActions}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
        {session.conversion && <Button variant="secondary" disabled={busy} onClick={() => onSessionChange({ ...session, reviewing: true })}>Return to review</Button>}
        <Button variant="primary" type="submit" disabled={busy || !session.text.trim() || !aiAvailable}>{busy ? 'Creating template…' : 'Create template'}</Button>
      </div>
    </form>}
  </Dialog>;
}
