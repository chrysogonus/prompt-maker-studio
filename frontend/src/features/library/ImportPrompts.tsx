'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { ApiClient } from '@/lib/api';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import { libraryHref } from '@/lib/libraryViews';
import { convertPlaceholders, findPlaceholders, ImportFile, ImportPrompt, isImportableFile, MAX_IMPORT_BYTES, parseImportFiles, parsePromptImport, pasteHandoffKey, titleFromFileName, validateImportPrompts } from '@/lib/promptImport';
import { MAX_ZIP_BYTES, readZip } from '@/lib/importArchive';
import type { PromptHistoryResponse } from '@/types/prompt';
import styles from './LibraryPage.module.css';

type PickedFile = { file: File; path: string };

/** Everything inside dropped files and folders, with each file's path in its folder. */
async function droppedFiles(items: DataTransferItemList): Promise<PickedFile[]> {
  const walk = async (entry: FileSystemEntry, path: string): Promise<PickedFile[]> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      return [{ file, path: `${path}${file.name}` }];
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    // Directory readers return entries in batches until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      children.push(...batch);
    }
    return (await Promise.all(children.map(child => walk(child, `${path}${entry.name}/`)))).flat();
  };
  const entries = [...items].map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => !!entry);
  return (await Promise.all(entries.map(entry => walk(entry, '')))).flat();
}

/** One prompt opens ready to use; several open where they were filed. */
function importedHref(created: PromptHistoryResponse[]): string {
  if (created.length === 1) return `/editor/${created[0].id}`;
  const folders = new Set(created.map((prompt) => prompt.folder));
  const [folder] = folders;
  return folders.size === 1 && folder ? libraryHref({ type: 'folder', folder }) : '/library';
}

export default function ImportPrompts({ onCreated, folders, existingTitles = [], primary = false }: {
  onCreated: (prompts: PromptHistoryResponse[]) => void;
  folders: string[];
  /** Titles already in the library; importing them again is skipped unless asked. */
  existingTitles?: string[];
  /** The empty library leads with importing, since most people arrive with prompts. */
  primary?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const imported = useRef<PromptHistoryResponse[]>([]);
  // A file's name is only a fallback title for that file, not for text pasted afterwards.
  const fileTitle = useRef(false);
  const close = () => {
    if (busy) return;
    setOpen(false);
    setDone(null);
    // Keep the empty-library dialog mounted until review/retries are finished.
    if (imported.current.length) { onCreated(imported.current); imported.current = []; }
  };
  const [source, setSource] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [preview, setPreview] = useState<ImportPrompt[] | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [done, setDone] = useState<PromptHistoryResponse[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [beforeConvert, setBeforeConvert] = useState<ImportPrompt[] | null>(null);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  // Whether tidying the notes changed anything, so keeping the original is a real choice.
  const [tidied, setTidied] = useState(false);
  // Placeholders the user unticked; everything else found is offered for conversion.
  const [unchosen, setUnchosen] = useState<string[]>([]);
  // Duplicates the user chose to import anyway, by preview position.
  const [copies, setCopies] = useState<number[]>([]);
  // The library only refreshes when the dialog closes, so count this session's imports too.
  const existing = new Set([...existingTitles, ...imported.current.map(prompt => prompt.name ?? '')].map(title => title.trim().toLowerCase()));
  const isDuplicate = (prompt: ImportPrompt) => existing.has(prompt.name.trim().toLowerCase());
  const skips = (prompt: ImportPrompt, index: number) => isDuplicate(prompt) && !copies.includes(index);
  const updateSource = (text: string) => { setSource(text); setPreview(null); setError(''); setResult(''); };
  const showPreview = (keep: boolean) => {
    try {
      const parse = (original: boolean) => files.length ? parseImportFiles(files, original) : { prompts: parsePromptImport(source, noteTitle, original), skipped: [] };
      const parsed = parse(keep);
      if (!parsed.prompts.length) throw new Error(`None of these files hold a prompt. ${parsed.skipped.join(' ')}`);
      setPreview(parsed.prompts);
      setSkipped(parsed.skipped);
      setTidied(JSON.stringify(parse(true).prompts) !== JSON.stringify(parse(false).prompts));
      setBeforeConvert(null); setUnchosen([]); setCopies([]); setError(''); setResult('');
    } catch (error) { setError((error as Error).message); }
  };
  // One file goes into the paste box to edit; several, or a folder, are listed instead.
  const readFiles = async (picked: PickedFile[], fromFolder: boolean) => {
    const isZip = (path: string) => /\.zip$/i.test(path);
    const notes = picked.filter(({ path }) => isImportableFile(path) || isZip(path));
    const ignored = picked.length - notes.length;
    updateSource('');
    setFiles([]);
    if (!notes.length) { setError(picked.length ? 'Choose .md, .txt, .csv or .json files, or a Notion .zip export.' : ''); return; }
    if (notes.some(({ file, path }) => file.size > (isZip(path) ? MAX_ZIP_BYTES : MAX_IMPORT_BYTES))) {
      setError('Import files must be 5 MB or smaller, and .zip exports 50 MB or smaller.');
      return;
    }
    setBusy(true);
    try {
      // A single note goes into the paste box to edit; exports and several files are listed.
      if (notes.length === 1 && !fromFolder && /\.(md|markdown|txt|json)$/i.test(notes[0].path)) {
        updateSource(await notes[0].file.text());
        setNoteTitle(titleFromFileName(notes[0].file.name));
        fileTitle.current = true;
      } else {
        const read = await Promise.all(notes.map(async ({ file, path }) => isZip(path)
          ? readZip(new Uint8Array(await file.arrayBuffer()))
          : [{ name: file.name, path, text: await file.text() }]));
        const found = read.flat();
        if (!found.length) { setError('This export holds no .md, .txt, .csv or .json notes.'); return; }
        setFiles(found);
        setNoteTitle('');
        if (ignored) setResult(`${ignored} other file${ignored === 1 ? ' was' : 's were'} ignored.`);
      }
    } catch (error) { setError(error instanceof Error && /zip/i.test(error.message) ? error.message : 'Could not read these files.'); }
    finally { setBusy(false); }
  };
  const fromNote = files.length ? files.some(file => !/\.(json|csv)$/i.test(file.name)) : !!source.trim() && !/^[{[]/.test(source.trim());
  // A fresh single note may go to AI conversion instead; retries and JSON exports may not.
  const singleNote = preview?.length === 1 && fromNote && files.length <= 1;
  const placeholders = preview ? findPlaceholders(preview) : [];
  const included = preview ? preview.filter((prompt, index) => !skips(prompt, index)).length : 0;
  const chosen = placeholders.filter(token => !unchosen.includes(token));
  const sharedFolder = preview?.every(prompt => (prompt.folder ?? '') === (preview[0].folder ?? '')) ? preview[0].folder ?? '' : '';
  const importPrompts = async () => {
    let validated: ImportPrompt[];
    const duplicates = preview!.filter(skips).length;
    try { validated = validateImportPrompts(preview!.filter((prompt, index) => !skips(prompt, index))); } catch (error) { setError((error as Error).message); return; }
    setBusy(true);
    setError('');
    const created: PromptHistoryResponse[] = [];
    const failed: ImportPrompt[] = [];
    for (const { is_favorite, ...prompt } of validated) {
      try {
        const saved = await ApiClient.createPrompt(prompt);
        // A failed favorite flag must not undo a successful import.
        created.push(is_favorite ? await ApiClient.updatePrompt(saved.id, { is_favorite }).catch(() => saved) : saved);
      } catch { failed.push(is_favorite ? { ...prompt, is_favorite } : prompt); }
    }
    if (created.length) { imported.current.push(...created); notifyLibraryChanged(); }
    setPreview(failed.length ? failed : null);
    setCopies([]);
    setBeforeConvert(null);
    setSource('');
    setFiles([]);
    setSkipped([]);
    setDone(failed.length ? null : created);
    setResult(`Imported ${created.length} of ${validated.length} prompts.${duplicates ? ` Skipped ${duplicates} already in your library.` : ''}${failed.length ? ` ${failed.length} failed; only these remain below for retry.` : ''}`);
    setBusy(false);
  };
  const reuseWithAI = () => {
    // The note's body, without frontmatter or its title line, keeping ## headings for the AI.
    const text = preview![0].fields.map(field => field.name === 'Prompt' ? field.content : `## ${field.name}\n${field.content}`).join('\n\n');
    const { name: title, folder } = preview![0];
    try { sessionStorage.setItem(pasteHandoffKey(), JSON.stringify({ text, title, folder })); } catch { /* The editor still opens Paste a prompt empty. */ }
    close();
    router.push('/editor/new?import=1');
  };
  return <>
    <Button variant={primary ? 'primary' : 'secondary'} onClick={() => setOpen(true)}>Add existing prompts</Button>
    <Dialog className={styles.importDialog} isOpen={open} title="Add existing prompts" onClose={close}>
      <div className={styles.form} data-dragging={dragging || undefined}
        onDragOver={event => { if (!preview && !done && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
        onDrop={event => {
          if (preview || done) return;
          event.preventDefault();
          setDragging(false);
          void droppedFiles(event.dataTransfer.items).then(picked => readFiles(picked, picked.some(({ path }) => path.includes('/'))));
        }}>
        {result && <p role="status">{result}</p>}
        {error && <p role="alert">{error}</p>}
        {done && <>
          <div className={styles.formActions}>
            <Button variant="ghost" onClick={() => { setDone(null); setResult(''); }}>Import more</Button>
            <Button variant="primary" onClick={() => { const href = importedHref(done); close(); router.push(href); }}>
              {done.length === 1 ? 'Open imported prompt' : 'Open imported prompts'}
            </Button>
          </div>
        </>}
        {!preview && !done && <>
          <p className={styles.dialogText}>Paste a prompt, choose files or a whole folder, or drop them here. Notion and Obsidian notes work as exported. You can review everything before it is added; existing prompts are never replaced.</p>
          <div className={styles.field}>
            <label htmlFor="import-source">Paste text</label>
            <textarea id="import-source" value={source} disabled={busy} onChange={event => { updateSource(event.target.value); if (fileTitle.current) { setNoteTitle(''); fileTitle.current = false; } }} rows={8}
              placeholder="For example: Summarize {{notes}} for {{team}} in three bullets." />
          </div>
          <div className={styles.field}>
            <label htmlFor="import-file">Or choose files: .md, .txt, .csv, .json, or a Notion .zip export</label>
            <input id="import-file" type="file" multiple accept=".json,.md,.markdown,.txt,.csv,.zip" disabled={busy}
              onChange={event => { void readFiles([...event.target.files ?? []].map(file => ({ file, path: file.name })), false); event.target.value = ''; }} />
          </div>
          <div className={styles.field}>
            <label htmlFor="import-folder">Or choose a folder, such as an Obsidian vault</label>
            <input id="import-folder" type="file" multiple disabled={busy} {...{ webkitdirectory: '' }}
              onChange={event => { void readFiles([...event.target.files ?? []].map(file => ({ file, path: file.webkitRelativePath || file.name })), true); event.target.value = ''; }} />
          </div>
          {files.length > 0 && <div className={styles.fileList} role="status">
            <p>{files.length} file{files.length === 1 ? '' : 's'} ready: {files.slice(0, 5).map(file => file.name).join(', ')}{files.length > 5 ? ` and ${files.length - 5} more` : ''}.</p>
            <Button variant="ghost" disabled={busy} onClick={() => { setFiles([]); setResult(''); }}>Clear files</Button>
          </div>}
          <div className={styles.field}>
            <label htmlFor="import-note-title">Title for a single note</label>
            <input id="import-note-title" value={noteTitle} onChange={event => setNoteTitle(event.target.value)} maxLength={100} placeholder="From the first line" disabled={busy} />
            <small>Used when the text has no # Title. You can change it in the preview.</small>
          </div>
          <details className={styles.dialogText}>
            <summary>Format details</summary>
            <p>A note without a heading is kept in one Prompt section. Note metadata is tidied first: YAML front matter, Notion page properties, Obsidian callouts and trailing #tags are removed, [[links]] read as text, the front matter title or first heading becomes the title, the first tag suggests a folder, and a Notion favourite stays a favourite. You can keep the original text in the preview.</p>
            <p>For several prompts in one note, start each with a heading and optionally add smaller headings for sections; a pasted page that starts at ## works the same way. Headings inside code fences remain text. Up to 100 prompts at a time.</p>
            <p>JSON files use the Prompt Maker Studio export format: titles, sections, folders, variable settings and favorites are copied. Version history, dates and notes are not imported; this is not a full archive restore.</p>
          </details>
          <Button variant="primary" disabled={busy || (!source.trim() && !files.length)} onClick={() => showPreview(keepOriginal)}>Preview</Button>
        </>}
        {preview && <>
          <p className={styles.dialogText}>Review {preview.length} prompt{preview.length === 1 ? '' : 's'} before importing. Edit titles and folders below; leave a folder empty for Unfiled.</p>
          {skipped.length > 0 && <p className={styles.dialogText}>Skipped: {skipped.join(' ')}</p>}
          {fromNote && tidied && <label className={styles.checkRow}>
            <input type="checkbox" checked={keepOriginal} disabled={busy} onChange={event => { setKeepOriginal(event.target.checked); showPreview(event.target.checked); }} />
            Keep the original note text (front matter, page properties, callouts and tags)
          </label>}
          {preview.length > 1 && <div className={styles.field}>
            <label htmlFor="import-folder-all">Folder for all prompts</label>
            <input id="import-folder-all" value={sharedFolder} list="import-folders" maxLength={255} disabled={busy} placeholder="Unfiled"
              onChange={event => setPreview(preview.map(item => ({ ...item, folder: event.target.value })))} />
          </div>}
          {placeholders.length > 0 && !beforeConvert && <fieldset className={styles.placeholderOffer}>
            <legend>Found {placeholders.length === 1 ? 'a placeholder' : `${placeholders.length} placeholders`}. Choose which become inputs you fill in:</legend>
            <div className={styles.placeholderChoices}>
              {placeholders.map(token => <label key={token}>
                <input type="checkbox" checked={!unchosen.includes(token)} disabled={busy}
                  onChange={event => setUnchosen(event.target.checked ? unchosen.filter(item => item !== token) : [...unchosen, token])} />
                <code>{token}</code>
              </label>)}
            </div>
            <Button variant="secondary" disabled={busy || !chosen.length} onClick={() => { setBeforeConvert(preview); setPreview(convertPlaceholders(preview, chosen)); }}>
              {placeholders.length === 1 ? 'Turn it into an input' : `Turn ${chosen.length === placeholders.length ? 'them' : chosen.length} into inputs`}
            </Button>
          </fieldset>}
          {beforeConvert && <p role="status" className={styles.dialogText}>Placeholders are now inputs you fill in before copying; their wording is kept as each input&apos;s hint.{' '}
            <Button variant="ghost" disabled={busy} onClick={() => { setPreview(preview.map((item, i) => ({ ...item, fields: beforeConvert[i].fields, variable_metadata: beforeConvert[i].variable_metadata }))); setBeforeConvert(null); }}>Undo</Button>
          </p>}
          <div className={styles.importPreview}>
            {preview.map((prompt, index) => <div className={styles.importItem} key={index}>
              <div className={styles.field}>
                <label htmlFor={`import-title-${index}`}>Title for prompt {index + 1}</label>
                <input id={`import-title-${index}`} value={prompt.name} maxLength={100} disabled={busy} onChange={event => setPreview(preview.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
              </div>
              <div className={styles.field}>
                <label htmlFor={`import-folder-${index}`}>Folder for {prompt.name}</label>
                <input id={`import-folder-${index}`} value={prompt.folder ?? ''} list="import-folders" maxLength={255} disabled={busy} onChange={event => setPreview(preview.map((item, i) => i === index ? { ...item, folder: event.target.value } : item))} />
              </div>
              {isDuplicate(prompt) && <label className={styles.checkRow}>
                <input type="checkbox" checked={copies.includes(index)} disabled={busy}
                  onChange={event => setCopies(event.target.checked ? [...copies, index] : copies.filter(item => item !== index))} />
                Already in your library. Import a copy anyway
              </label>}
              <details open={preview.length <= 5}><summary>{prompt.fields.length} section{prompt.fields.length === 1 ? '' : 's'}</summary>{prompt.fields.map(field => <div key={field.name}><strong>{field.name}</strong><pre className={styles.importText}>{field.content}</pre></div>)}</details>
            </div>)}
          </div>
          {singleNote && <p className={styles.dialogText}>Keep it as written, or let AI split it into sections and suggest inputs (needs an AI connection).</p>}
          <div className={styles.formActions}>
            <Button variant="ghost" disabled={busy} onClick={() => { setPreview(null); setBeforeConvert(null); setError(''); }}>Back</Button>
            {singleNote && <Button variant="secondary" disabled={busy} onClick={reuseWithAI}>Make reusable with AI</Button>}
            <Button variant="primary" disabled={busy || !included} onClick={() => void importPrompts()}>{busy ? 'Importing…' : !included ? 'Nothing new to import' : singleNote ? 'Keep as written' : `Import ${included} prompt${included === 1 ? '' : 's'}`}</Button>
          </div>
        </>}
        <Button variant="ghost" disabled={busy} onClick={close}>Close</Button>
        <datalist id="import-folders">{folders.map(folder => <option key={folder} value={folder} />)}</datalist>
      </div>
    </Dialog>
  </>;
}
