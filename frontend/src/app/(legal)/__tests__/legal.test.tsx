import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImpressumPage from '../impressum/page';
import DatenschutzPage from '../datenschutz/page';
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

  it('is not found when the deployment provides no file', async () => {
    await expect(DatenschutzPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('/legal.json reports which pages exist', async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ pages: ['impressum'] });
  });
});
