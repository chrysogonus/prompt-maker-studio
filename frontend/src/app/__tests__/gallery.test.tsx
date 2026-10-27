import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GalleryPage, { generateMetadata as indexMetadata } from '../gallery/page';
import TemplatePage, { generateMetadata as templateMetadata } from '../gallery/[slug]/page';
import GalleryLayout from '../gallery/layout';
import { GALLERY, GALLERY_CATEGORIES } from '@/lib/gallery';

vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
afterEach(() => vi.unstubAllEnvs());

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe('Prompt gallery', () => {
  it('lists every template under its category, with popular ones first', () => {
    const { container } = render(<GalleryPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Free prompt templates');
    const index = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(index['@type']).toBe('CollectionPage');
    expect(index.mainEntity.itemListElement).toHaveLength(GALLERY.length);
    expect(within(screen.getByRole('region', { name: 'Featured' })).getAllByRole('link')).toHaveLength(6);
    for (const category of GALLERY_CATEGORIES) {
      const section = screen.getByRole('region', { name: category.label });
      for (const template of GALLERY.filter((item) => item.category === category.id)) {
        expect(within(section).getByRole('link', { name: template.title })).toHaveAttribute('href', `/gallery/${template.slug}`);
      }
    }
  });

  it('filters templates by words in their title, summary or text', async () => {
    const user = userEvent.setup();
    render(<GalleryPage />);
    await user.type(screen.getByRole('searchbox', { name: 'Search templates' }), 'regression test');
    expect(screen.getByRole('status')).toHaveTextContent('1 template');
    expect(screen.getByRole('link', { name: 'Bug fix brief for a coding agent' })).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search templates' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search templates' }), 'zzznothing');
    expect(screen.getByRole('status')).toHaveTextContent('No templates match.');
  });

  it('shows a template ready to fill in, with tips, its guide and related templates', async () => {
    render(await TemplatePage(params('bug-fix-brief')));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bug fix brief for a coding agent');
    expect(screen.getByRole('textbox', { name: 'symptom' })).toHaveAttribute('placeholder', 'What goes wrong, and how to reproduce it');
    expect(screen.getByRole('button', { name: 'Use example inputs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'how to write prompts for coding agents' })).toHaveAttribute('href', '/guides/prompts-for-coding-agents');
    expect(within(screen.getByRole('region', { name: 'More coding-agent templates' })).getAllByRole('link')).toHaveLength(4);
  });

  it('gives every template a search-length description and structured data', async () => {
    for (const template of GALLERY) {
      const { description } = await templateMetadata(params(template.slug));
      expect(description!.length, template.slug).toBeGreaterThanOrEqual(110);
      expect(description!.length, template.slug).toBeLessThanOrEqual(160);
    }
    vi.stubEnv('FRONTEND_URL', 'https://gallery.example');
    const { container } = render(await TemplatePage(params('bug-fix-brief')));
    const [breadcrumbs, work] = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(breadcrumbs.itemListElement.map((crumb: { item: string }) => crumb.item)).toEqual(['https://gallery.example/gallery', 'https://gallery.example/gallery/bug-fix-brief']);
    expect(work).toMatchObject({
      '@type': 'CreativeWork', name: 'Bug fix brief for a coding agent', url: 'https://gallery.example/gallery/bug-fix-brief', isAccessibleForFree: true,
      isPartOf: { url: 'https://gallery.example/' }, publisher: { '@type': 'Organization' },
    });
  });

  it('answers an unknown template with not found', async () => {
    await expect(TemplatePage(params('missing'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(await templateMetadata(params('missing'))).toEqual({});
  });

  it('builds index and template metadata from the origin at request time', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://gallery.example');
    expect(indexMetadata().alternates?.canonical).toBe('https://gallery.example/gallery');
    const meta = await templateMetadata(params('meeting-summary'));
    expect(meta.alternates?.canonical).toBe('https://gallery.example/gallery/meeting-summary');
    expect(meta.title).toContain('Meeting summary with action items: free prompt template');
  });

  it('wraps the gallery in the public shell with a Templates link', () => {
    render(<GalleryLayout><p>Gallery</p></GalleryLayout>);
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/gallery');
  });
});
