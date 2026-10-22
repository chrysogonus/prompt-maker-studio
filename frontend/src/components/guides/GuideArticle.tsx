import type { ReactNode } from 'react';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { APP_NAME } from '@/lib/branding';
import { galleryPath, templatesForGuide } from '@/lib/gallery';
import { GUIDES } from '@/lib/guides';
import GuideList from './GuideList';
import styles from './Guides.module.css';

export default function GuideArticle({ guide, children }: {
  guide: (typeof GUIDES)[keyof typeof GUIDES];
  children: ReactNode;
}) {
  return (
    <article className={styles.article}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <Link href="/guides">All guides</Link>
      </nav>
      <header>
        <h1>{guide.title}</h1>
        <p className={styles.intro}>{guide.description}</p>
      </header>
      <div className={styles.prose}>{children}</div>
      {templatesForGuide(guide.path).length > 0 && (
        <section className={styles.next} aria-labelledby="templates-to-start-from">
          <h2 id="templates-to-start-from">Templates to start from</h2>
          <ul className={styles.guideList}>
            {templatesForGuide(guide.path).slice(0, 4).map((template) => (
              <li key={template.slug}>
                <Link href={galleryPath(template.slug)}>{template.title}</Link>
                <p>{template.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles.next} aria-labelledby="put-it-to-use">
        <h2 id="put-it-to-use">Put it to use</h2>
        <p>
          Sign in to keep your own library. Writing, saving, filling in, and copying prompts needs
          no AI provider connection. Paste a prompt, Refine, and Try once are optional actions
          that use the provider you connect.
        </p>
        <ButtonLink href="/library" variant="primary">Open {APP_NAME}</ButtonLink>
      </section>
      <section className={styles.next} aria-labelledby="keep-learning">
        <h2 id="keep-learning">Keep learning</h2>
        <GuideList exclude={guide.path} />
      </section>
    </article>
  );
}
