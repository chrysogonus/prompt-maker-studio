import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
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

/** A legal pages folder holding only an Impressum. */
function withImpressum() {
  const dir = mkdtempSync(path.join(tmpdir(), 'legal-pages-'));
  writeFileSync(path.join(dir, 'impressum.html'), '<h1>Impressum</h1>');
  vi.stubEnv('LEGAL_PAGES_DIR', dir);
}

describe('Landing page', () => {
  it('describes the product to signed-out visitors and links into the app', async () => {
    render(await LandingPage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('reuse your best AI prompts');
    expect(screen.getByText(/import Markdown notes, such as Notion or Obsidian exports/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open the app' }).length).toBeGreaterThan(2);
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

    expect(screen.getByRole('link', { name: 'See how' })).toHaveAttribute('href', '/guides/connect-chatgpt-claude');
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');

    expect(screen.getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides');
    for (const href of [
      '/guides/reusable-ai-prompts',
      '/guides/prompt-template-variables',
      '/guides/organize-chatgpt-prompts',
    ]) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeInTheDocument();
    }
  });

  it('describes the site and the app as structured data on this origin', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example');
    const { container } = render(await LandingPage());
    const [site, app] = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);

    expect(site).toMatchObject({ '@type': 'WebSite', url: 'https://prompts.example/', publisher: { '@type': 'Organization', '@id': 'https://github.com/chrysogonus/prompt-maker-studio#project' } });
    expect(app).toMatchObject({
      '@type': 'WebApplication', url: 'https://prompts.example/', operatingSystem: 'Web',
      offers: { price: 0 }, author: { url: 'https://github.com/chrysogonus/prompt-maker-studio' },
    });
  });

  it('serves the screenshots as responsive WebP', async () => {
    render(await LandingPage());

    for (const image of screen.getAllByRole('img').filter((img) => img.getAttribute('src')?.startsWith('/landing/'))) {
      expect(image.getAttribute('src')).toMatch(/\.webp$/);
      expect(image.getAttribute('srcset')).toMatch(/-720\.webp 720w, .*\.webp 1440w$/);
      expect(image).toHaveAttribute('sizes');
    }
    expect(screen.getAllByRole('img').filter((img) => img.getAttribute('src')?.startsWith('/landing/'))).toHaveLength(2);
  });

  it("links the operator's legal pages in the server-rendered footer", async () => {
    withImpressum();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(await LandingPage());

    expect(screen.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', '/impressum');
    expect(screen.queryByRole('link', { name: 'Privacy policy' })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('builds canonical and preview links from FRONTEND_URL at request time', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example/');
    const metadata = await generateMetadata();

    expect(metadata.alternates?.canonical).toBe('https://prompts.example/');
    expect(metadata.description!.length).toBeLessThanOrEqual(160);
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: 'https://prompts.example/landing/editor.png' }),
    ]);
  });
});

describe('robots.txt and sitemap.xml', () => {
  it('point crawlers at the public origin and away from signed-in pages', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example');
    const rules = robots();

    expect(rules.sitemap).toBe('https://prompts.example/sitemap.xml');
    expect(rules.rules).toMatchObject({ allow: '/', disallow: expect.arrayContaining(['/library', '/api/']) });
    expect(await sitemap()).toEqual([
      { url: 'https://prompts.example/' },
      { url: 'https://prompts.example/about' },
      { url: 'https://prompts.example/guides' },
      { url: 'https://prompts.example/guides/what-is-a-prompt-library', lastModified: '2026-10-27' },
      { url: 'https://prompts.example/guides/reusable-ai-prompts', lastModified: '2026-10-26' },
      { url: 'https://prompts.example/guides/prompt-template-variables', lastModified: '2026-10-27' },
      { url: 'https://prompts.example/guides/organize-chatgpt-prompts', lastModified: '2026-10-26' },
      { url: 'https://prompts.example/guides/what-makes-a-good-prompt', lastModified: '2026-10-27' },
      { url: 'https://prompts.example/guides/prompts-for-coding-agents', lastModified: '2026-10-27' },
      { url: 'https://prompts.example/guides/image-generation-prompts', lastModified: '2026-10-27' },
      { url: 'https://prompts.example/guides/research-and-writing-prompts', lastModified: '2026-10-22' },
      { url: 'https://prompts.example/guides/connect-chatgpt-claude', lastModified: '2026-10-27' },
      { url: 'https://prompts.example/tools' },
      { url: 'https://prompts.example/tools/prompt-template-filler' },
      { url: 'https://prompts.example/tools/prompt-linter' },
      { url: 'https://prompts.example/tools/prompt-refiner' },
      { url: 'https://prompts.example/tools/prompt-diff' },
      { url: 'https://prompts.example/tools/token-counter' },
      { url: 'https://prompts.example/gallery' },
      ...GALLERY.map(({ slug }) => ({ url: `https://prompts.example/gallery/${slug}` })),
    ]);
  });

  it("lists the operator's legal pages that exist", async () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example');
    withImpressum();

    const urls = (await sitemap()).map(({ url }) => url);
    expect(urls).toContain('https://prompts.example/impressum');
    expect(urls).not.toContain('https://prompts.example/datenschutz');
  });
});
