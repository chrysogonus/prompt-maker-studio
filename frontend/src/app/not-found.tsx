import Link from 'next/link';
import type { Metadata } from 'next';
import { pageTitle } from '@/lib/branding';
import Wordmark from '@/components/ui/Wordmark';
import styles from './not-found.module.css';

export const metadata: Metadata = {
  title: pageTitle('Page not found'),
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Wordmark className={styles.wordmark} />
        <p className={styles.code}>404</p>
        <h1>Page not found</h1>
        <p>The page you requested does not exist or may have moved.</p>
        <Link href="/">Back to dashboard</Link>
      </div>
    </main>
  );
}
