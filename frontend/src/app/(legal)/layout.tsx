import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';
import Wordmark from '@/components/ui/Wordmark';
import styles from './legal.module.css';

// Impressum and Datenschutzerklärung must be reachable without signing in,
// so they live outside the (app) group and its auth gate.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="Back to the app">
          <Wordmark />
        </Link>
      </header>
      <main className={styles.content}>{children}</main>
      <footer className={styles.footer}>
        <LegalLinks className={styles.legalLinks} />
        <Link href="/">Back to the app</Link>
      </footer>
    </div>
  );
}
