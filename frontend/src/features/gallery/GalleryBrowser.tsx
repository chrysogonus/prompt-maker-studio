'use client';

import Link from 'next/link';
import { useState } from 'react';
import Input from '@/components/ui/Input';
import { GALLERY, GALLERY_CATEGORIES, featuredTemplates, galleryPath, type GalleryTemplate } from '@/lib/gallery';
import guideStyles from '@/components/guides/Guides.module.css';
import styles from './Gallery.module.css';

function matches(template: GalleryTemplate, query: string): boolean {
  const text = [template.title, template.summary, ...template.sections.map((section) => section.content)].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

function TemplateList({ templates }: { templates: GalleryTemplate[] }) {
  return (
    <ul className={guideStyles.guideList}>
      {templates.map((template) => (
        <li key={template.slug}>
          <Link href={galleryPath(template.slug)}>{template.title}</Link>
          <p>{template.summary}</p>
        </li>
      ))}
    </ul>
  );
}

/** The whole gallery, rendered on the server too; search filters it in the browser. */
export default function GalleryBrowser() {
  const [query, setQuery] = useState('');
  const results = query.trim() ? GALLERY.filter((template) => matches(template, query)) : null;
  return (
    <>
      <label className={styles.search}>
        <span>Search templates</span>
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="For example: meeting, bug, portrait" />
      </label>
      {results ? (
        <section aria-labelledby="results-title">
          <h2 id="results-title" className={styles.heading}>Results</h2>
          <p role="status" className={styles.count}>
            {results.length === 0 ? 'No templates match.' : `${results.length} ${results.length === 1 ? 'template' : 'templates'}`}
          </p>
          <TemplateList templates={results} />
        </section>
      ) : (
        <>
          <nav aria-label="Categories" className={styles.categories}>
            {GALLERY_CATEGORIES.map((category) => <a key={category.id} href={`#${category.id}`}>{category.label}</a>)}
          </nav>
          <section aria-labelledby="featured-title">
            <h2 id="featured-title" className={styles.heading}>Featured</h2>
            <TemplateList templates={featuredTemplates()} />
          </section>
          {GALLERY_CATEGORIES.map((category) => (
            <section key={category.id} id={category.id} aria-labelledby={`${category.id}-title`} className={styles.category}>
              <h2 id={`${category.id}-title`} className={styles.heading}>{category.label}</h2>
              <p className={styles.count}>{category.description}</p>
              <TemplateList templates={GALLERY.filter((template) => template.category === category.id)} />
            </section>
          ))}
        </>
      )}
    </>
  );
}
