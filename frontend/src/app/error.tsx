'use client';

import { useEffect } from 'react';
import Button from '@/components/ui/Button';
import styles from './error.module.css';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.message}>
          An unexpected error occurred. You can try again, or head back to the Dashboard.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => (window.location.href = '/')}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
