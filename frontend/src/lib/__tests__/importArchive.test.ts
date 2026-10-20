import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readZip } from '@/lib/importArchive';

/** A minimal zip writer for tests: CRCs are left at 0 because the reader does not check them. */
function zip(entries: Record<string, string | Uint8Array>, deflate = true): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(entries)) {
    const name = Buffer.from(path);
    const raw = Buffer.from(content);
    const data = deflate ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(deflate ? 8 : 0, 10);
    header.writeUInt32LE(data.length, 20); header.writeUInt32LE(raw.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    central.push(header, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

describe('readZip', () => {
  it('reads the notes and CSVs in a Notion export, skipping other files', async () => {
    const files = await readZip(zip({
      'Prompts 3f2a/Cold email 8b7e.md': '# Cold email\nWrite to [Name].',
      'Prompts 3f2a.csv': 'Name,Prompt\nCold email,Write to [Name].',
      'Prompts 3f2a/image.png': 'png',
      '.DS_Store': 'x',
    }));
    expect(files.map(file => file.path)).toEqual(['Prompts 3f2a/Cold email 8b7e.md', 'Prompts 3f2a.csv']);
  });

  it('reads stored entries and opens nested parts', async () => {
    expect(await readZip(zip({ 'Prompts.csv': 'Name,Prompt\nA,B' }, false))).toEqual([{ name: 'Prompts.csv', path: 'Prompts.csv', text: 'Name,Prompt\nA,B' }]);
    const outer = zip({ 'Export-Part-1.zip': zip({ 'Notes/One.md': 'One' }) });
    expect(await readZip(outer)).toEqual([{ name: 'One.md', path: 'Export-Part-1.zip/Notes/One.md', text: 'One' }]);
  });

  it('explains a file that is not a zip, and an HTML export', async () => {
    await expect(readZip(new TextEncoder().encode('just text'))).rejects.toThrow('could not be read');
    await expect(readZip(zip({ 'Prompts 3f2a.html': '<h1>Prompts</h1>' }))).rejects.toThrow('choose Markdown & CSV');
  });
});
