import { isImportableFile, type ImportFile } from '@/lib/promptImport';

/** Notion exports can be large; each note inside is still limited when it is parsed. */
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;

const fail = (message: string): never => { throw new Error(message); };

/**
 * The notes inside a .zip (such as a Notion "Markdown & CSV" export), read with the
 * browser's own decompression. Notion splits large exports into zips inside a zip,
 * so one level of nesting is opened too.
 */
export async function readZip(bytes: Uint8Array, prefix = ''): Promise<ImportFile[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) fail('This .zip file could not be read.');
  let offset = view.getUint32(end + 16, true);
  // ponytail: no ZIP64; exports over 4 GB or 65,535 files must be unzipped first.
  if (offset === 0xffffffff) fail('This .zip file is too large to read here. Unzip it, then choose its folder.');
  const decoder = new TextDecoder();
  const files: ImportFile[] = [];
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    if (view.getUint32(offset, true) !== 0x02014b50) fail('This .zip file could not be read.');
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    const nested = /\.zip$/i.test(path) && !prefix;
    if (path.endsWith('/') || (!nested && !isImportableFile(path)) || (method !== 0 && method !== 8)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    const data = method === 0 ? raw
      : new Uint8Array(await new Response(new Response(raw.slice()).body!.pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    if (nested) files.push(...await readZip(data, `${path}/`));
    else files.push({ name: path.split('/').pop()!, path: prefix + path, text: decoder.decode(data) });
  }
  // A Notion database exports its rows both as pages and as a CSV; the pages hold more.
  return files.some(file => !/\.csv$/i.test(file.name)) ? files.filter(file => !/\.csv$/i.test(file.name)) : files;
}
