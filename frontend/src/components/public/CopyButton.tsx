'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import styles from './Tools.module.css';

/** Copies a fixed text, such as a template shown on a server-rendered page, and says whether it worked. */
export default function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied.');
    } catch {
      setStatus('Copying failed. Select the text above and copy it.');
    }
  };

  return (
    <p className={styles.actions}>
      <Button onClick={() => void copy()} aria-label={label}>Copy</Button>
      <span className={styles.status} role="status">{status}</span>
    </p>
  );
}
