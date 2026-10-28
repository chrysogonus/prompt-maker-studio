import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ToolsIndexPage, { generateMetadata as indexMetadata } from '../tools/page';
import FillerPage, { generateMetadata as fillerMetadata } from '../tools/prompt-template-filler/page';
import LinterPage, { generateMetadata as linterMetadata } from '../tools/prompt-linter/page';
import DiffPage, { generateMetadata as diffMetadata } from '../tools/prompt-diff/page';
import TokensPage, { generateMetadata as tokensMetadata } from '../tools/token-counter/page';
import RefinerPage, { generateMetadata as refinerMetadata } from '../tools/prompt-refiner/page';
import ToolsLayout from '../tools/layout';

vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  ApiClient: {
    getPublicModelPrices: vi.fn(() => Promise.resolve([])),
    getPublicRefineStatus: vi.fn(() => Promise.resolve({ available: true, max_chars: 8000 })),
  },
}));

afterEach(() => vi.unstubAllEnvs());

const tools = [
  { Page: FillerPage, metadata: fillerMetadata, path: '/tools/prompt-template-filler' },
  { Page: LinterPage, metadata: linterMetadata, path: '/tools/prompt-linter' },
  { Page: DiffPage, metadata: diffMetadata, path: '/tools/prompt-diff' },
  { Page: TokensPage, metadata: tokensMetadata, path: '/tools/token-counter' },
  { Page: RefinerPage, metadata: refinerMetadata, path: '/tools/prompt-refiner' },
];

describe('Free tools', () => {
  it('lists every tool on the index', () => {
    const { container } = render(<ToolsIndexPage />);
    for (const { path } of tools) expect(document.querySelector(`a[href="${path}"]`)).toBeInTheDocument();
    const index = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(index['@type']).toBe('CollectionPage');
    expect(index.mainEntity.itemListElement).toHaveLength(tools.length);
  });

  it.each(tools)('gives $path help, an FAQ, a way into the app and the other tools', async ({ Page, path }) => {
    const { container } = render(<Page />);
    await act(async () => {}); // The token counter loads prices on mount.

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // The refiner is the one tool that sends text, and says so.
    expect(container.querySelector('header')).toHaveTextContent(path.endsWith('prompt-refiner')
      ? /sends your prompt to this site's AI provider/ : /Runs in your browser; nothing is uploaded\.$/);
    expect(screen.getByRole('heading', { name: 'Questions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All tools' })).toHaveAttribute('href', '/tools');
    expect(screen.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/library');
    const more = screen.getByRole('region', { name: 'More free tools' });
    expect(within(more).getAllByRole('link')).toHaveLength(tools.length - 1);
    expect(more.querySelector(`a[href="${path}"]`)).not.toBeInTheDocument();
    const [app, crumbs, faq] = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(app).toMatchObject({
      '@type': 'WebApplication', isAccessibleForFree: true, offers: { price: 0 },
      author: { '@id': 'https://github.com/chrysogonus/prompt-maker-studio#project' }, publisher: { '@id': 'https://github.com/chrysogonus/prompt-maker-studio#project' },
    });
    expect(app.url).toMatch(new RegExp(`${path}$`));
    expect(crumbs.itemListElement).toHaveLength(2);
    expect(faq['@type']).toBe('FAQPage');
    expect(faq.mainEntity.length).toBeGreaterThan(0);
  });

  it.each([{ metadata: indexMetadata, path: '/tools' }, ...tools])('builds $path metadata from the origin at request time', ({ metadata, path }) => {
    vi.stubEnv('FRONTEND_URL', 'https://tools.example');
    const result = metadata();
    expect(result.alternates?.canonical).toBe(`https://tools.example${path}`);
    expect(result.title).toMatch(/^Free /);
    expect(result.description!.length).toBeGreaterThanOrEqual(110);
    expect(result.description!.length).toBeLessThanOrEqual(160);
  });

  it('wraps tools in the public shell with Guides, Tools and the app', async () => {
    render(await ToolsLayout({ children: <p>Tool</p> }));
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides');
    expect(within(nav).getByRole('link', { name: 'Tools' })).toHaveAttribute('href', '/tools');
    expect(within(nav).getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/library');
  });
});
