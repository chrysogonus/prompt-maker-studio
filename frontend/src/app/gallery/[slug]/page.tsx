import Link from 'next/link';
import { notFound } from 'next/navigation';
import guideStyles from '@/components/guides/Guides.module.css';
import JsonLd, { project, breadcrumbs } from '@/components/public/JsonLd';
import styles from '@/components/public/Tools.module.css';
import TemplateFiller from '@/features/tools/TemplateFiller';
import { siteUrl } from '@/lib/branding';
import { GALLERY_CATEGORIES, galleryDescription, galleryMetadata, galleryPath, galleryTemplate, relatedTemplates } from '@/lib/gallery';
import { GUIDES } from '@/lib/guides';
import { fillVariables, renderSections } from '@/lib/sections';
import { TOOLS } from '@/lib/tools';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const template = galleryTemplate((await params).slug);
  return template ? galleryMetadata(template) : {};
}

export default async function GalleryTemplatePage({ params }: Params) {
  const template = galleryTemplate((await params).slug);
  if (!template) notFound();
  const category = GALLERY_CATEGORIES.find((item) => item.id === template.category)!;
  const guide = template.guide ? GUIDES[template.guide] : undefined;
  const related = relatedTemplates(template);
  const url = `${siteUrl()}${galleryPath(template.slug)}`;
  const structuredData = [
    // No category crumb: a #fragment is the same URL as the gallery itself.
    breadcrumbs(['Templates', '/gallery'], [template.title, galleryPath(template.slug)]),
    {
      '@context': 'https://schema.org', '@type': 'CreativeWork',
      name: template.title, description: galleryDescription(template), url,
      inLanguage: 'en', isAccessibleForFree: true, genre: category.label,
      isPartOf: { '@type': 'WebSite', url: `${siteUrl()}/` }, publisher: project(),
    },
  ];
  return (
    <article className={styles.toolArticle}>
      <nav aria-label="Breadcrumb" className={guideStyles.breadcrumb}>
        <Link href="/gallery">All templates</Link> · <Link href={`/gallery#${category.id}`}>{category.label}</Link>
      </nav>
      <header>
        <h1>{template.title}</h1>
        <p className={guideStyles.intro}>{template.summary}</p>
        <p className={styles.local}>Free to use and change. Filling in and copying happen in your browser.</p>
      </header>
      <JsonLd data={structuredData} />
      <section className={styles.widget} aria-label="Fill in this template">
        <TemplateFiller title={template.title} fields={template.sections} hints={template.hints} examples={template.examples} />
      </section>
      <div className={guideStyles.prose}>
        <h2>How it is built</h2>
        <ul>
          {template.sections.map((section) => (
            <li key={section.name}><strong>{section.name}</strong>: {section.content.split('\n')[0]}</li>
          ))}
        </ul>
        <h2>Example, filled in</h2>
        <p>With the example inputs, the prompt you copy reads:</p>
        <pre>{renderSections(template.sections.map((section) => ({ ...section, content: fillVariables(section.content, template.examples) })))}</pre>
        <h2>What to expect</h2>
        <p>{template.outcome}</p>
        {template.tips.length > 0 && (
          <>
            <h2>Tips</h2>
            <ul>{template.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
          </>
        )}
        <p>
          {guide && <>Read <Link href={guide.path}>{guide.title.charAt(0).toLowerCase() + guide.title.slice(1)}</Link> for the reasoning behind templates like this. </>}
          Adapting it? Check your version with the <Link href={TOOLS.linter.path}>prompt checker</Link>.
        </p>
      </div>
      {related.length > 0 && (
        <section className={guideStyles.next} aria-labelledby="more-templates">
          <h2 id="more-templates">More {category.noun} templates</h2>
          <ul className={guideStyles.guideList}>
            {related.map((item) => (
              <li key={item.slug}>
                <Link href={galleryPath(item.slug)}>{item.title}</Link>
                <p>{item.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
