import { REPOSITORY_URL } from '@/components/RepositoryLink';
import { APP_NAME, siteUrl } from '@/lib/branding';

const CONTEXT = 'https://schema.org';

/** The project's maintainer, named by GitHub handle: true on every deployment, unlike the operator. */
export const MAINTAINER = { name: 'chrysogonus', url: 'https://github.com/chrysogonus' };

/**
 * The open-source project, not this deployment's operator: every self-hosted copy serves the same
 * image. The repository-based @id is the same everywhere, so the copies on each page merge into one.
 */
export function project() {
  return {
    '@type': 'Organization', '@id': `${REPOSITORY_URL}#project`, name: APP_NAME, url: REPOSITORY_URL,
    logo: `${siteUrl()}/icon-512.png`, sameAs: [REPOSITORY_URL], founder: { '@type': 'Person', ...MAINTAINER },
  };
}

export const FREE_OFFER = { '@type': 'Offer', price: 0, priceCurrency: 'USD' };

/** Breadcrumbs from [name, path] pairs on this deployment's origin. */
export function breadcrumbs(...crumbs: [string, string][]) {
  return {
    '@context': CONTEXT, '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, path], index) => ({
      '@type': 'ListItem', position: index + 1, name, item: `${siteUrl()}${path}`,
    })),
  };
}

/** An index page and the pages it lists. */
export function collection(page: { path: string; title: string; description: string }, paths: string[]) {
  return {
    '@context': CONTEXT, '@type': 'CollectionPage',
    name: page.title, description: page.description, url: `${siteUrl()}${page.path}`,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: paths.map((path, index) => ({ '@type': 'ListItem', position: index + 1, url: `${siteUrl()}${path}` })),
    },
  };
}

/** Structured data for crawlers; `<` is escaped so no value can close the script element. */
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
