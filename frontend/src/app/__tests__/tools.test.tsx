import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ToolsIndexPage, { generateMetadata as indexMetadata } from '../tools/page';
import FillerPage, { generateMetadata as fillerMetadata } from '../tools/prompt-template-filler/page';
import LinterPage, { generateMetadata as linterMetadata } from '../tools/prompt-linter/page';
import DiffPage, { generateMetadata as diffMetadata } from '../tools/prompt-diff/page';
import TokensPage, { generateMetadata as tokensMetadata } from '../tools/token-counter/page';
import ToolsLayout from '../tools/layout';

vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  ApiClient: { getPublicModelPrices: vi.fn(() => Promise.resolve([])) },
}));

afterEach(() => vi.unstubAllEnvs());

const tools = [
  { Page: FillerPage, metadata: fillerMetadata, path: '/tools/prompt-template-filler' },
  { Page: LinterPage, metadata: linterMetadata, path: '/tools/prompt-linter' },
  { Page: DiffPage, metadata: diffMetadata, path: '/tools/prompt-diff' },
  { Page: TokensPage, metadata: tokensMetadata, path: '/tools/token-counter' },
];

describe('Free tools', () => {
  it('lists every tool on the index', () => {
    render(<ToolsIndexPage />);
    for (const { path } of tools) expect(document.querySelector(`a[href="${path}"]`)).toBeInTheDocument();
  });

  it.each(tools)('gives $path help, an FAQ, a way into the app and the other tools', async ({ Page, path }) => {
    const { container } = render(<Page />);
    await act(async () => {}); // The token counter loads prices on mount.

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Runs in your browser. Nothing you enter is uploaded.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Questions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All tools' })).toHaveAttribute('href', '/tools');
    expect(screen.getByRole('link', { name: 'Open Prompt Maker Studio' })).toHaveAttribute('href', '/library');
    const more = screen.getByRole('region', { name: 'More free tools' });
    expect(within(more).getAllByRole('link')).toHaveLength(tools.length - 1);
    expect(more.querySelector(`a[href="${path}"]`)).not.toBeInTheDocument();
    const faq = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(faq['@type']).toBe('FAQPage');
    expect(faq.mainEntity.length).toBeGreaterThan(0);
  });

  it.each([{ metadata: indexMetadata, path: '/tools' }, ...tools])('builds $path metadata from the origin at request time', ({ metadata, path }) => {
    vi.stubEnv('FRONTEND_URL', 'https://tools.example');
    expect(metadata().alternates?.canonical).toBe(`https://tools.example${path}`);
  });

  it('wraps tools in the public shell with Guides, Tools and the app', () => {
    render(<ToolsLayout><p>Tool</p></ToolsLayout>);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides');
    expect(within(nav).getByRole('link', { name: 'Tools' })).toHaveAttribute('href', '/tools');
    expect(within(nav).getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/library');
  });
});
