import type { ReactNode } from 'react';
import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';
import Wordmark from '@/components/ui/Wordmark';
import { APP_NAME } from '@/lib/branding';
import styles from '@/app/page.module.css';

/** Header and footer for public pages (guides, tools), which stay public with a session too. */
export default function PublicShell({ children, contentId, homeLabel, homeHref }: {
  children: ReactNode;
  contentId: string;
  /** The section this page belongs to, linked in the footer. */
  homeLabel: string;
  homeHref: string;
}) {
  return (
    <div className={styles.page}>
      <a href={`#${contentId}`} className={styles.skipLink}>Skip to content</a>
      <header className={styles.header}>
        <Link href="/" className={styles.home} aria-label={`${APP_NAME} home`}>
          <Wordmark icon="mark" />
        </Link>
        <nav aria-label="Main navigation" className={styles.navigation}>
          <Link href="/guides" className={styles.signIn}>Guides</Link>
          <Link href="/tools" className={styles.signIn}>Tools</Link>
          <Link href="/library" className={styles.signIn}>Open the app</Link>
        </nav>
      </header>
      <main id={contentId}>{children}</main>
      <footer className={styles.footer}>
        <span>{APP_NAME}</span>
        <Link href={homeHref}>{homeLabel}</Link>
        <LegalLinks className={styles.legalLinks} />
      </footer>
    </div>
  );
}
