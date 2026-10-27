import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GuidesPage, { generateMetadata as indexMetadata } from '../guides/page';
import ReusablePromptsPage, { generateMetadata as reusableMetadata } from '../guides/reusable-ai-prompts/page';
import TemplateVariablesPage, { generateMetadata as variablesMetadata } from '../guides/prompt-template-variables/page';
import OrganizePromptsPage, { generateMetadata as organizeMetadata } from '../guides/organize-chatgpt-prompts/page';
import GoodPromptPage, { generateMetadata as goodPromptMetadata } from '../guides/what-makes-a-good-prompt/page';
import CodingAgentsPage, { generateMetadata as codingAgentsMetadata } from '../guides/prompts-for-coding-agents/page';
import ImagePromptsPage, { generateMetadata as imagePromptsMetadata } from '../guides/image-generation-prompts/page';
import ResearchWritingPage, { generateMetadata as researchWritingMetadata } from '../guides/research-and-writing-prompts/page';

afterEach(() => vi.unstubAllEnvs());

const articles = [
  { Page: ReusablePromptsPage, metadata: reusableMetadata, path: '/guides/reusable-ai-prompts' },
  { Page: TemplateVariablesPage, metadata: variablesMetadata, path: '/guides/prompt-template-variables' },
  { Page: OrganizePromptsPage, metadata: organizeMetadata, path: '/guides/organize-chatgpt-prompts' },
  { Page: GoodPromptPage, metadata: goodPromptMetadata, path: '/guides/what-makes-a-good-prompt' },
  { Page: CodingAgentsPage, metadata: codingAgentsMetadata, path: '/guides/prompts-for-coding-agents' },
  { Page: ImagePromptsPage, metadata: imagePromptsMetadata, path: '/guides/image-generation-prompts' },
  { Page: ResearchWritingPage, metadata: researchWritingMetadata, path: '/guides/research-and-writing-prompts' },
];

describe('Public guides', () => {
  it('gives readers a route from the index to each article', () => {
    vi.stubEnv('FRONTEND_URL', 'https://guides.example');
    const { container } = render(<GuidesPage />);

    for (const { path } of articles) {
      expect(document.querySelector(`a[href="${path}"]`)).toBeInTheDocument();
    }
    const index = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(index).toMatchObject({ '@type': 'CollectionPage', url: 'https://guides.example/guides' });
    expect(index.mainEntity.itemListElement.map((item: { url: string }) => item.url))
      .toEqual(articles.map(({ path }) => `https://guides.example${path}`));
  });

  it.each(articles)('dates $path and describes it as an article', ({ Page, path }) => {
    vi.stubEnv('FRONTEND_URL', 'https://guides.example');
    const { container } = render(<Page />);

    const updated = container.querySelector('header time')!;
    expect(updated.getAttribute('dateTime')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(updated.textContent).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    const [crumbs, article] = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(crumbs.itemListElement.map((crumb: { item: string }) => crumb.item))
      .toEqual(['https://guides.example/guides', `https://guides.example${path}`]);
    expect(article).toMatchObject({
      '@type': 'Article', url: `https://guides.example${path}`, dateModified: updated.getAttribute('dateTime'),
      author: { '@type': 'Organization' }, publisher: { '@type': 'Organization' },
    });
    expect(article.datePublished <= article.dateModified).toBe(true);
  });

  it.each(articles)('links $path to the app, the index and the other articles', ({ Page, path }) => {
    render(<Page />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('link', { name: 'All guides' })).toHaveAttribute('href', '/guides');
    const related = screen.getByRole('region', { name: 'Keep learning' });
    for (const other of articles.filter((article) => article.path !== path)) {
      expect(related.querySelector(`a[href="${other.path}"]`)).toBeInTheDocument();
    }
    expect(within(related).getAllByRole('link')).toHaveLength(articles.length - 1);
  });

  it.each([
    { metadata: indexMetadata, path: '/guides' },
    ...articles,
  ])('builds $path metadata using the origin at request time', ({ metadata, path }) => {
    vi.stubEnv('FRONTEND_URL', 'https://first.example/');
    expect(metadata().alternates?.canonical).toBe(`https://first.example${path}`);

    vi.stubEnv('FRONTEND_URL', 'https://second.example');
    const result = metadata();
    expect(result.alternates?.canonical).toBe(`https://second.example${path}`);
    expect(result.openGraph).toMatchObject({
      type: path === '/guides' ? 'website' : 'article',
      url: `https://second.example${path}`,
      title: result.title,
      description: result.description,
      images: [{ url: 'https://second.example/landing/editor.png', width: 1440, height: 900 }],
    });
    expect(result.twitter).toMatchObject({
      card: 'summary_large_image', title: result.title, description: result.description,
      images: ['https://second.example/landing/editor.png'],
    });
  });
});
