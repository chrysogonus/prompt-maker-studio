'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { ApiClient } from '@/lib/api';
import { PromptField } from '@/types/prompt';
import styles from './PromptEditor.module.css';

interface ImportDialogProps {
  isOpen: boolean;
  aiAvailable: boolean;
  replacesContent: boolean;
  onClose: () => void;
  onImport: (fields: PromptField[]) => void;
}

export default function ImportDialog({
  isOpen,
  aiAvailable,
  replacesContent,
  onClose,
  onImport,
}: ImportDialogProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!aiAvailable) {
    return (
      <Dialog isOpen={isOpen} title="Import text needs an AI connection" onClose={onClose}>
        <p className={styles.dialogText}>
          Import text uses an AI model to turn a pasted prompt or rough notes into sections. Connect
          a provider in Settings to use it. You can always write sections by hand.
        </p>
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Link className={styles.buttonLink} href="/settings#s-api">
            Open Settings
          </Link>
        </div>
      </Dialog>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await ApiClient.parsePromptText({ text: text.trim() });
      onImport(result.fields);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} title="Import text" onClose={() => !busy && onClose()}>
      <form className={styles.dialogForm} onSubmit={submit}>
        <p className={styles.dialogText}>
          Paste a prompt you already use, or rough notes. It will be split into sections you can
          edit.
        </p>
        <textarea
          className={styles.importText}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste text here"
          aria-label="Text to import"
          maxLength={10_000}
          disabled={busy}
          autoFocus
        />
        {replacesContent && (
          <small className={styles.dialogHint}>The imported sections replace your current ones.</small>
        )}
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !text.trim()}>
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
