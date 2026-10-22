import { render, screen } from '@testing-library/react';
import { GALLERY } from '@/lib/gallery';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LandingPage, { generateMetadata } from '../page';
import robots from '../robots';
import sitemap from '../sitemap';

const cookieNames = vi.hoisted(() => new Set<string>());

vi.mock('next/headers', () => ({
  cookies: async () => ({ has: (name: string) => cookieNames.has(name) }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

afterEach(() => {
  cookieNames.clear();
  vi.unstubAllEnvs();
});

describe('Landing page', () => {
  it('describes the product to signed-out visitors and links into the app', async () => {
    render(await LandingPage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('reuse your best AI prompts');
    expect(screen.getByText(/import Markdown notes, such as Notion or Obsidian exports/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/library');
    for (const link of screen.getAllByRole('link', { name: 'Open the app' })) {
      expect(link).toHaveAttribute('href', '/library');
    }
  });

  it('sends anyone with a session straight to their library', async () => {
    cookieNames.add('access_token');
    await expect(LandingPage()).rejects.toThrow('NEXT_REDIRECT /library');
  });

  it('helps visitors discover the guides and their individual articles', async () => {
    render(await LandingPage());

    expect(screen.getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides');
    for (const href of [
      '/guides/reusable-ai-prompts',
      '/guides/prompt-template-variables',
      '/guides/organize-chatgpt-prompts',
    ]) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeInTheDocument();
    }
  });

  it('builds canonical and preview links from FRONTEND_URL at request time', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example/');
    const metadata = await generateMetadata();

    expect(metadata.alternates?.canonical).toBe('https://prompts.example/');
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: 'https://prompts.example/landing/editor.png' }),
    ]);
  });
});

describe('robots.txt and sitemap.xml', () => {
  it('point crawlers at the public origin and away from signed-in pages', () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example');
    const rules = robots();

    expect(rules.sitemap).toBe('https://prompts.example/sitemap.xml');
    expect(rules.rules).toMatchObject({ allow: '/', disallow: expect.arrayContaining(['/library', '/api/']) });
    expect(sitemap()).toEqual([
      { url: 'https://prompts.example/' },
      { url: 'https://prompts.example/guides' },
      { url: 'https://prompts.example/guides/reusable-ai-prompts' },
      { url: 'https://prompts.example/guides/prompt-template-variables' },
      { url: 'https://prompts.example/guides/organize-chatgpt-prompts' },
      { url: 'https://prompts.example/guides/what-makes-a-good-prompt' },
      { url: 'https://prompts.example/guides/prompts-for-coding-agents' },
      { url: 'https://prompts.example/guides/image-generation-prompts' },
      { url: 'https://prompts.example/guides/research-and-writing-prompts' },
      { url: 'https://prompts.example/tools' },
      { url: 'https://prompts.example/tools/prompt-template-filler' },
      { url: 'https://prompts.example/tools/prompt-linter' },
      { url: 'https://prompts.example/tools/prompt-diff' },
      { url: 'https://prompts.example/tools/token-counter' },
      { url: 'https://prompts.example/gallery' },
      ...GALLERY.map(({ slug }) => ({ url: `https://prompts.example/gallery/${slug}` })),
    ]);
  });
});
