'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Button from './ui/Button';
import Wordmark from './ui/Wordmark';
import styles from './NavBar.module.css';

const TABS = [
  { href: '/', label: 'Dashboard' },
  { href: '/library', label: 'Library' },
  { href: '/editor/new', label: 'Editor' },
  { href: '/settings', label: 'Settings' },
];

export default function NavBar() {
  const pathname = usePathname();
  const { logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <header className={styles.header} role="banner">
      <nav className={styles.nav}>
        <Wordmark icon="mark" className={styles.brand} />
        <div className={styles.desktopTabs}>
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={styles.tab}
              data-active={isActive(tab.href)}
              aria-current={isActive(tab.href) ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        <div className={styles.desktopSpacer} />
        <div className={styles.desktopActions}>
          <Button variant="secondary" onClick={logout}>
            Sign out
          </Button>
        </div>

        <button
          type="button"
          className={styles.hamburger}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="Toggle navigation menu"
          aria-expanded={isOpen}
        >
          <span className={styles.hamburgerBar} />
          <span className={styles.hamburgerBar} />
          <span className={styles.hamburgerBar} />
        </button>

        {isOpen && (
          <div className={styles.mobileMenu}>
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={styles.mobileTab}
                data-active={isActive(tab.href)}
                aria-current={isActive(tab.href) ? 'page' : undefined}
                onClick={() => setIsOpen(false)}
              >
                {tab.label}
              </Link>
            ))}
            <Button
              variant="secondary"
              onClick={() => {
                logout();
                setIsOpen(false);
              }}
              className={styles.mobileLogout}
            >
              Sign out
            </Button>
          </div>
        )}
      </nav>
    </header>
  );
}
