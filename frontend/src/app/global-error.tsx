'use client';

import { useEffect } from 'react';
import { APP_NAME } from '@/lib/branding';
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled root-layout error:', error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px',
            background: 'var(--color-canvas)',
          }}
        >
          <div
            style={{
              maxWidth: 480,
              textAlign: 'center',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-lg)',
              padding: '32px',
            }}
          >
            <h1
              style={{
                fontSize: 'var(--text-xl-size)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--text-primary)',
                marginBottom: '12px',
              }}
            >
              Something went wrong
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
              {APP_NAME} hit an unexpected error and couldn&apos;t load. Try reloading the page.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                background: 'var(--color-accent-tag)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '10px 20px',
                fontSize: 'var(--text-base-size)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
