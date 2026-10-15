import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GuidesPage, { generateMetadata as indexMetadata } from '../guides/page';
import ReusablePromptsPage, { generateMetadata as reusableMetadata } from '../guides/reusable-ai-prompts/page';
import TemplateVariablesPage, { generateMetadata as variablesMetadata } from '../guides/prompt-template-variables/page';
import OrganizePromptsPage, { generateMetadata as organizeMetadata } from '../guides/organize-chatgpt-prompts/page';

afterEach(() => vi.unstubAllEnvs());

const articles = [
  { Page: ReusablePromptsPage, metadata: reusableMetadata, path: '/guides/reusable-ai-prompts' },
  { Page: TemplateVariablesPage, metadata: variablesMetadata, path: '/guides/prompt-template-variables' },
  { Page: OrganizePromptsPage, metadata: organizeMetadata, path: '/guides/organize-chatgpt-prompts' },
];

describe('Public guides', () => {
  it('gives readers a route from the index to each article', () => {
    render(<GuidesPage />);

    for (const { path } of articles) {
      expect(document.querySelector(`a[href="${path}"]`)).toBeInTheDocument();
    }
  });

  it.each(articles)('links $path to the app, the index and the other articles', ({ Page, path }) => {
    render(<Page />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open Prompt Maker Studio' })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('link', { name: 'All guides' })).toHaveAttribute('href', '/guides');
    const related = screen.getByRole('region', { name: 'Keep learning' });
    for (const other of articles.filter((article) => article.path !== path)) {
      expect(related.querySelector(`a[href="${other.path}"]`)).toBeInTheDocument();
    }
    expect(within(related).getAllByRole('link')).toHaveLength(2);
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
