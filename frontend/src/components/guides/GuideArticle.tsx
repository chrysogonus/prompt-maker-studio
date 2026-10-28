import type { ReactNode } from 'react';
import Link from 'next/link';
import JsonLd, { project, breadcrumbs } from '@/components/public/JsonLd';
import { ButtonLink } from '@/components/ui/Button';
import { siteUrl } from '@/lib/branding';
import { galleryPath, templatesForGuide } from '@/lib/gallery';
import { GUIDES } from '@/lib/guides';
import GuideList from './GuideList';
import styles from './Guides.module.css';

export default function GuideArticle({ guide, children }: {
  guide: (typeof GUIDES)[keyof typeof GUIDES];
  children: ReactNode;
}) {
  const url = `${siteUrl()}${guide.path}`;
  const structuredData = [
    breadcrumbs(['Guides', '/guides'], [guide.title, guide.path]),
    {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: guide.title, description: guide.description, url, mainEntityOfPage: url,
      image: `${siteUrl()}/landing/editor.png`, inLanguage: 'en',
      datePublished: guide.published, dateModified: guide.updated, author: project(), publisher: project(),
    },
  ];
  return (
    <article className={styles.article}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <Link href="/guides">All guides</Link>
      </nav>
      <header>
        <h1>{guide.title}</h1>
        <p className={styles.intro}>{guide.description}</p>
        <p className={styles.updated}>
          Updated <time dateTime={guide.updated}>{new Date(guide.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</time>
        </p>
      </header>
      <JsonLd data={structuredData} />
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
          Sign in to keep your own library. Writing, saving, filling in and copying prompts need
          no AI provider. Paste a prompt, Refine, and Try once are optional actions
          that use the provider you connect.
        </p>
        <ButtonLink href="/library" variant="primary">Open the app</ButtonLink>
      </section>
      <section className={styles.next} aria-labelledby="keep-learning">
        <h2 id="keep-learning">Keep learning</h2>
        <GuideList exclude={guide.path} />
      </section>
    </article>
  );
}
