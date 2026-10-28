import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AboutPage, { generateMetadata } from '../about/page';
import { GET as llmsTxt } from '../llms.txt/route';
import { GALLERY } from '@/lib/gallery';
import { GUIDES } from '@/lib/guides';
import { TOOLS } from '@/lib/tools';

afterEach(() => vi.unstubAllEnvs());

describe('About page', () => {
  it('names this host and points to the operator only through their own legal pages', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example');
    const dir = mkdtempSync(path.join(tmpdir(), 'legal-pages-'));
    writeFileSync(path.join(dir, 'impressum.html'), '<h1>Impressum</h1>');
    vi.stubEnv('LEGAL_PAGES_DIR', dir);
    const { container } = render(await AboutPage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('About Prompt Maker Studio');
    expect(screen.getByText(/prompts\.example runs Prompt Maker Studio/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Impressum' })[0]).toHaveAttribute('href', '/impressum');
    expect(screen.queryByRole('link', { name: 'privacy policy' })).not.toBeInTheDocument();
    const data = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(data).toMatchObject({
      '@type': 'AboutPage', url: 'https://prompts.example/about',
      mainEntity: {
        '@type': 'Organization', '@id': 'https://github.com/chrysogonus/prompt-maker-studio#project', logo: 'https://prompts.example/icon-512.png',
        sameAs: ['https://github.com/chrysogonus/prompt-maker-studio'],
        founder: { '@type': 'Person', name: 'chrysogonus', url: 'https://github.com/chrysogonus' },
      },
    });
  });

  it('says who builds the project and where to report problems', async () => {
    render(await AboutPage());

    expect(screen.getByRole('heading', { name: 'Who builds it' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@chrysogonus' })).toHaveAttribute('href', 'https://github.com/chrysogonus');
    expect(screen.getByRole('link', { name: 'GitHub issues' })).toHaveAttribute('href', 'https://github.com/chrysogonus/prompt-maker-studio/issues');
    expect(screen.getByRole('heading', { name: 'How it handles your prompts' })).toBeInTheDocument();
  });

  it('says nothing about an operator when the deployment has no legal pages', async () => {
    vi.stubEnv('LEGAL_PAGES_DIR', '');
    render(await AboutPage());

    expect(screen.queryByText(/operator is named/)).not.toBeInTheDocument();
  });

  it('builds its metadata from the origin at request time', () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example');
    const metadata = generateMetadata();

    expect(metadata.alternates?.canonical).toBe('https://prompts.example/about');
    expect(metadata.description!.length).toBeGreaterThanOrEqual(110);
    expect(metadata.description!.length).toBeLessThanOrEqual(160);
  });
});

describe('llms.txt', () => {
  it('lists the public pages on this origin as plain text', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example/');
    const response = llmsTxt();
    const text = await response.text();

    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(text).toMatch(/^# Prompt Maker Studio\n\n> /);
    for (const { path: page } of [...Object.values(GUIDES), ...Object.values(TOOLS)]) {
      expect(text).toContain(`(https://prompts.example${page})`);
    }
    expect(text.match(/\(https:\/\/prompts\.example\/gallery\//g)).toHaveLength(GALLERY.length);
    expect(text).toContain('[MCP server](https://prompts.example/api/mcp)');
  });
});
