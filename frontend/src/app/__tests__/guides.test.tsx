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
