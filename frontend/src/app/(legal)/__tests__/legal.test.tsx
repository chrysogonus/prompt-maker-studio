import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImpressumPage, { generateMetadata as impressumMetadata } from '../impressum/page';
import DatenschutzPage, { generateMetadata as datenschutzMetadata } from '../datenschutz/page';
import TermsPage, { generateMetadata as termsMetadata } from '../terms/page';
import LegalLayout from '../layout';
import { GET } from '../../legal.json/route';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'legal-pages-'));
  writeFileSync(path.join(dir, 'impressum.html'), '<h1>Impressum</h1><p>Operator Name</p>');
  vi.stubEnv('LEGAL_PAGES_DIR', dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Legal pages', () => {
  it("renders the operator's file", async () => {
    render(await ImpressumPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Impressum' })).toBeInTheDocument();
    expect(screen.getByText('Operator Name')).toBeInTheDocument();
  });

  it('links the pages that exist in the server-rendered footer', async () => {
    render(await LegalLayout({ children: <p>Page</p> }));

    expect(screen.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', '/impressum');
    expect(screen.queryByRole('link', { name: 'Terms of service' })).not.toBeInTheDocument();
  });

  it.each([
    { metadata: impressumMetadata, href: '/impressum' },
    { metadata: datenschutzMetadata, href: '/datenschutz' },
    { metadata: termsMetadata, href: '/terms' },
  ])('gives $href its own description and a canonical link on this origin', ({ metadata, href }) => {
    vi.stubEnv('FRONTEND_URL', 'https://legal.example/');
    const result = metadata();

    expect(result.alternates?.canonical).toBe(`https://legal.example${href}`);
    expect(result.description).toMatch(/\S/);
  });

  it('is not found when the deployment provides no file', async () => {
    await expect(DatenschutzPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('/legal.json reports which pages exist', async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ pages: ['impressum'] });
  });

  it('renders terms from the deployment file without a session', async () => {
    writeFileSync(path.join(process.env.LEGAL_PAGES_DIR!, 'nutzungsbedingungen.html'),
      '<h1>Terms of Service</h1><p>Deployment terms</p>');

    render(await TermsPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getByText('Deployment terms')).toBeInTheDocument();
  });

  it('reads updated terms on the next request', async () => {
    const file = path.join(process.env.LEGAL_PAGES_DIR!, 'nutzungsbedingungen.html');
    writeFileSync(file, '<p>Original terms</p>');
    const { rerender } = render(await TermsPage());
    expect(screen.getByText('Original terms')).toBeInTheDocument();

    writeFileSync(file, '<p>Revised terms</p>');
    rerender(await TermsPage());

    expect(screen.getByText('Revised terms')).toBeInTheDocument();
    expect(screen.queryByText('Original terms')).not.toBeInTheDocument();
  });

  it('returns not found when the terms file is absent', async () => {
    await expect(TermsPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('returns not found when no legal directory is configured', async () => {
    vi.stubEnv('LEGAL_PAGES_DIR', '');

    await expect(TermsPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('/legal.json includes terms when its deployment file exists', async () => {
    writeFileSync(path.join(process.env.LEGAL_PAGES_DIR!, 'nutzungsbedingungen.html'), '<p>Terms</p>');

    const response = await GET();

    expect(await response.json()).toEqual({ pages: ['impressum', 'nutzungsbedingungen'] });
  });
});
