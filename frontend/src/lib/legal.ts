import { readFile } from 'fs/promises';
import path from 'path';
import { LEGAL_PAGES, type LegalSlug } from '@/lib/legal-pages';

/**
 * Operator-supplied legal pages (Impressum, privacy policy).
 *
 * Their content identifies whoever runs a deployment, so it cannot ship in the
 * published image. Each operator mounts their own HTML fragments into the
 * frontend container and points LEGAL_PAGES_DIR at them; a page whose file is
 * missing simply does not exist. Server-only — reads the filesystem.
 */
/** The page's HTML, or null when the deployment provides none. */
export async function readLegalPage(slug: LegalSlug): Promise<string | null> {
  const dir = process.env.LEGAL_PAGES_DIR;
  if (!dir) return null;
  try {
    return await readFile(path.join(dir, `${slug}.html`), 'utf8');
  } catch {
    return null;
  }
}

export async function availableLegalPages(): Promise<LegalSlug[]> {
  const pages = await Promise.all(
    LEGAL_PAGES.map(async ({ slug }) => ((await readLegalPage(slug)) === null ? null : slug)),
  );
  return pages.filter((slug): slug is LegalSlug => slug !== null);
}
