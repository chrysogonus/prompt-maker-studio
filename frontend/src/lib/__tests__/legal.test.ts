import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { availableLegalPages, readLegalPage } from '@/lib/legal';

function legalDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'legal-pages-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('legal pages', () => {
  it('provides nothing when the deployment configures no directory', async () => {
    vi.stubEnv('LEGAL_PAGES_DIR', '');
    expect(await readLegalPage('impressum')).toBeNull();
    expect(await availableLegalPages()).toEqual([]);
  });

  it("reads the operator's HTML and lists only the pages that exist", async () => {
    vi.stubEnv('LEGAL_PAGES_DIR', legalDir({ 'impressum.html': '<h1>Impressum</h1>' }));

    expect(await readLegalPage('impressum')).toBe('<h1>Impressum</h1>');
    expect(await readLegalPage('datenschutz')).toBeNull();
    expect(await availableLegalPages()).toEqual(['impressum']);
  });
});
