import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';
import Wordmark from '@/components/ui/Wordmark';
import { APP_NAME } from '@/lib/branding';
import styles from '../page.module.css';

// Metadata must use FRONTEND_URL at request time, including on published images.
// Guides stay public even when the reader has an app session.
export const dynamic = 'force-dynamic';

export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <a href="#guide-content" className={styles.skipLink}>Skip to content</a>
      <header className={styles.header}>
        <Link href="/" className={styles.home} aria-label={`${APP_NAME} home`}>
          <Wordmark icon="mark" />
        </Link>
        <nav aria-label="Main navigation" className={styles.navigation}>
          <Link href="/guides" className={styles.signIn}>Guides</Link>
          <Link href="/library" className={styles.signIn}>Open the app</Link>
        </nav>
      </header>
      <main id="guide-content">{children}</main>
      <footer className={styles.footer}>
        <span>{APP_NAME}</span>
        <Link href="/guides">All guides</Link>
        <LegalLinks className={styles.legalLinks} />
      </footer>
    </div>
  );
}
