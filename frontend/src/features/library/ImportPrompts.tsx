'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { ApiClient } from '@/lib/api';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import { libraryHref } from '@/lib/libraryViews';
import { convertPlaceholders, findPlaceholders, ImportFile, ImportPrompt, importProblem, isImportableFile, MAX_IMPORT_BYTES, noteFlag, parseImportFiles, parsePromptImport, pasteHandoffKey, reapplyConversions, splitLongSections, titleFromFileName, validateImportPrompts, withoutTitleLine } from '@/lib/promptImport';
import { MAX_ZIP_BYTES, readZip } from '@/lib/importArchive';
import type { PromptField, PromptHistoryResponse } from '@/types/prompt';
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

const plural = (count: number, word: string) => `${count.toLocaleString('en')} ${word}${count === 1 ? '' : 's'}`;
const titleKey = (prompt: { name?: string | null }) => (prompt.name ?? '').trim().toLowerCase();
const sameTitle = (a: { name?: string | null }, b: { name?: string | null }) => titleKey(a) === titleKey(b);
const sameText = (a: PromptField[], b: PromptField[]) =>
  JSON.stringify(a.map(field => [field.name, field.content])) === JSON.stringify(b.map(field => [field.name, field.content]));

/** Common root of a chosen or dropped folder: its notes are filed by their own folders, not its name. */
function withoutRoot(picked: PickedFile[]): PickedFile[] {
  const root = picked[0]?.path.split('/')[0];
  return picked.every(({ path }) => path.startsWith(`${root}/`)) ? picked.map(({ file, path }) => ({ file, path: path.slice(root.length + 1) })) : picked;
}

export default function ImportPrompts({ onCreated, folders, existing = [], primary = false }: {
  /** Prompts created or updated by the import. */
  onCreated: (prompts: PromptHistoryResponse[]) => void;
  folders: string[];
  /** The library; a prompt whose title is already there is skipped unless a copy or an update is chosen. */
  existing?: PromptHistoryResponse[];
  /** The empty library leads with importing, since most people arrive with prompts. */
  primary?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Closing keeps an unfinished preview; reopening says so and offers to start over.
  const [resumed, setResumed] = useState(false);
  const imported = useRef<PromptHistoryResponse[]>([]);
  const folderInput = useRef<HTMLInputElement>(null);
  // A file's name is only a fallback title for that file, not for text pasted afterwards.
  const fileTitle = useRef(false);
  // Where that single file was, so a template there is flagged like one among several files.
  const notePath = useRef('');
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
  // How many prompts have been sent so far, while importing.
  const [progress, setProgress] = useState(0);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [beforeConvert, setBeforeConvert] = useState<ImportPrompt[] | null>(null);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  // Whether tidying the notes changed anything, so keeping the original is a real choice.
  const [tidied, setTidied] = useState(false);
  // Placeholders the user unticked; everything else found is offered for conversion.
  const [unchosen, setUnchosen] = useState<string[]>([]);
  // Preview positions the user ticked or unticked: new prompts start ticked, duplicates unticked.
  const [toggled, setToggled] = useState<number[]>([]);
  // Duplicates whose library prompt should be updated (as a new version) instead.
  const [updating, setUpdating] = useState<number[]>([]);
  // The library only refreshes when the dialog closes, so count this session's imports too.
  const [sessionPrompts, setSessionPrompts] = useState<PromptHistoryResponse[]>([]);
  // Library prompts by title, newest first; this session's imports replace their stale library copies.
  const byTitle = useMemo(() => {
    const map = new Map<string, PromptHistoryResponse[]>();
    for (const prompt of [...sessionPrompts].reverse().concat(existing)) {
      const same = map.get(titleKey(prompt)) ?? [];
      if (!same.some(other => other.id === prompt.id)) map.set(titleKey(prompt), [...same, prompt]);
    }
    return map;
  }, [sessionPrompts, existing]);
  const matches = (prompt: ImportPrompt) => byTitle.get(titleKey(prompt)) ?? [];
  const isDuplicate = (prompt: ImportPrompt) => matches(prompt).length > 0;
  // Changed when no prompt of that title has its text; placeholders converted on the first import do not count.
  const isChanged = (prompt: ImportPrompt) => isDuplicate(prompt)
    && !matches(prompt).some(current => sameText(prompt.fields, current.fields) || sameText(reapplyConversions(prompt, current).fields, current.fields));
  // Only an unambiguous match can be updated: with several prompts of one title, the wrong one could be overwritten.
  const updateTarget = (prompt: ImportPrompt) => matches(prompt).length === 1 ? matches(prompt)[0] : undefined;
  const startsUnticked = (prompt: ImportPrompt) => isDuplicate(prompt) || !!prompt.flag;
  const ticked = (prompt: ImportPrompt, index: number) => startsUnticked(prompt) === toggled.includes(index);
  // What a prompt chosen for update will send: its earlier inputs again. Limits, Split and the
  // placeholder offer all use this, since converting can make a section longer.
  const willSend = (prompt: ImportPrompt, index: number) =>
    updating.includes(index) && isChanged(prompt) && updateTarget(prompt) ? reapplyConversions(prompt, updateTarget(prompt)!) : prompt;
  const updates = (prompt: ImportPrompt, index: number) => updating.includes(index) && isChanged(prompt) && !!updateTarget(prompt) && !importProblem(willSend(prompt, index));
  // A ticked prompt is imported once nothing stops it.
  const included = (prompt: ImportPrompt, index: number) => ticked(prompt, index) && !updating.includes(index) && !importProblem(prompt);
  const startOver = () => {
    setPreview(null); setFiles([]); setSource(''); setNoteTitle(''); setSkipped([]); setToggled([]); setUpdating([]);
    setBeforeConvert(null); setUnchosen([]); setKeepOriginal(false); setError(''); setResult(''); setResumed(false);
    fileTitle.current = false;
  };
  const updateSource = (text: string) => { setSource(text); setPreview(null); setError(''); setResult(''); };
  const showPreview = (keep: boolean) => {
    try {
      const flag = files.length || /^[{[]/.test(source.trim()) ? undefined : noteFlag({ name: '', path: fileTitle.current ? notePath.current : '', text: source });
      const parse = (original: boolean) => files.length ? parseImportFiles(files, original)
        : { prompts: parsePromptImport(source, noteTitle, original).map(prompt => flag ? { ...prompt, flag } : prompt), skipped: [] };
      const parsed = parse(keep);
      if (!parsed.prompts.length) throw new Error(`None of these files hold a prompt. ${parsed.skipped.join(' ')}`);
      setPreview(parsed.prompts);
      setSkipped(parsed.skipped);
      setTidied(JSON.stringify(parse(true).prompts) !== JSON.stringify(parse(false).prompts));
      setBeforeConvert(null); setUnchosen([]); setToggled([]); setUpdating([]); setError(''); setResult('');
    } catch (error) { setError((error as Error).message); }
  };
  // One file goes into the paste box to edit; several, or a folder, are listed instead.
  const readFiles = async (chosen: PickedFile[], fromFolder: boolean) => {
    const picked = fromFolder ? withoutRoot(chosen) : chosen;
    const isZip = (path: string) => /\.zip$/i.test(path);
    const notes = picked.filter(({ path }) => isImportableFile(path) || isZip(path));
    const ignored = picked.filter(item => !notes.includes(item)).map(({ path }) => path);
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
        notePath.current = notes[0].path;
      } else {
        const read = await Promise.all(notes.map(async ({ file, path }) => isZip(path)
          ? readZip(new Uint8Array(await file.arrayBuffer()))
          : [{ name: file.name, path, text: await file.text() }]));
        const found = read.flat().sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
        if (!found.length) { setError('This export holds no .md, .txt, .csv or .json notes.'); return; }
        setFiles(found);
        setNoteTitle('');
        if (ignored.length) setResult(`Ignored ${plural(ignored.length, 'other file')}: ${ignored.slice(0, 5).join(', ')}${ignored.length > 5 ? ` and ${ignored.length - 5} more` : ''}.`);
      }
    } catch (error) { setError(error instanceof Error && /zip/i.test(error.message) ? error.message : 'Could not read these files.'); }
    finally { setBusy(false); }
  };
  const fromNote = files.length ? files.some(file => !/\.(json|csv)$/i.test(file.name)) : !!source.trim() && !/^[{[]/.test(source.trim());
  // A fresh single note may go to AI conversion instead; retries and JSON exports may not.
  const singleNote = preview?.length === 1 && fromNote && files.length <= 1;
  const offered = preview ? preview.flatMap((prompt, index) => ticked(prompt, index) || updates(prompt, index) ? [willSend(prompt, index)] : []) : [];
  const placeholders = findPlaceholders(offered);
  const usedIn = (token: string) => offered.filter(prompt => findPlaceholders([prompt]).includes(token)).length;
  const count = preview ? preview.filter(included).length : 0;
  const updateCount = preview ? preview.filter(updates).length : 0;
  const problems = preview ? preview.filter((prompt, index) => (ticked(prompt, index) || updating.includes(index)) && importProblem(willSend(prompt, index))).length : 0;
  const chosen = placeholders.filter(token => !unchosen.includes(token));
  const mixedFolders = !!preview?.some(prompt => (prompt.folder ?? '') !== (preview[0].folder ?? ''));
  const sharedFolder = preview && !mixedFolders ? preview[0].folder ?? '' : '';
  const importPrompts = async () => {
    let validated: ImportPrompt[];
    let toUpdate: ImportPrompt[] = [];
    const duplicates = preview!.filter((prompt, index) => isDuplicate(prompt) && !ticked(prompt, index) && !updates(prompt, index)).length;
    const leftOut = preview!.length - duplicates - count - updateCount;
    try {
      validated = count ? validateImportPrompts(preview!.filter(included)) : [];
      toUpdate = updateCount ? validateImportPrompts(preview!.filter(updates)) : [];
    } catch (error) { setError((error as Error).message); return; }
    setBusy(true);
    setProgress(0);
    setError('');
    const created: PromptHistoryResponse[] = [];
    const failed: ImportPrompt[] = [];
    for (const { is_favorite, ...prompt } of validated) {
      try {
        const saved = await ApiClient.createPrompt(prompt);
        // A failed favorite flag must not undo a successful import.
        created.push(is_favorite ? await ApiClient.updatePrompt(saved.id, { is_favorite }).catch(() => saved) : saved);
      } catch { failed.push(is_favorite ? { ...prompt, is_favorite } : prompt); }
      setProgress(created.length + failed.length);
    }
    let updated = 0;
    for (const prompt of toUpdate) {
      const current = updateTarget(prompt)!;
      const next = reapplyConversions(prompt, current);
      try {
        // The library prompt's current text stays in its History; a concurrent edit fails with 409 and stays for retry.
        created.push(await ApiClient.updatePrompt(current.id, {
          // Settings made in the library win for inputs it already has, so converting here never replaces them.
          fields: next.fields, ...(next.variable_metadata && { variable_metadata: { ...next.variable_metadata, ...current.variable_metadata } }),
          note: 'Updated from import', ...(current.updated_at && { last_updated_at: current.updated_at }),
        }));
        updated++;
      } catch { failed.push(prompt); }
      setProgress(created.length + failed.length);
    }
    if (created.length) {
      imported.current.push(...created);
      setSessionPrompts(prompts => [...prompts, ...created]);
      notifyLibraryChanged();
    }
    setPreview(failed.length ? failed : null);
    setToggled([]);
    setUpdating([]);
    setBeforeConvert(null);
    setSource('');
    setFiles([]);
    setSkipped([]);
    setDone(failed.length ? null : created);
    // Only the counts that happened; "of" only when some imports failed.
    const added = created.length - updated;
    const summary = [
      added < validated.length ? `imported ${added} of ${plural(validated.length, 'prompt')}` : added && `imported ${plural(added, 'prompt')}`,
      updated && `updated ${updated} (earlier text kept in History)`,
      duplicates && `skipped ${duplicates} already in your library`,
      leftOut && `left out ${leftOut} not selected or needing changes`,
    ].filter(Boolean).join(', ');
    setResult([summary && `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`, failed.length && `${failed.length} failed; only these remain below for retry.`].filter(Boolean).join(' '));
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
  const edit = (index: number, change: (prompt: ImportPrompt) => ImportPrompt) => setPreview(preview!.map((item, i) => i === index ? change(item) : item));
  const toggle = (index: number) => setToggled(toggled.includes(index) ? toggled.filter(item => item !== index) : [...toggled, index]);
  return <>
    <Button variant={primary ? 'primary' : 'secondary'} onClick={() => { setResumed(!!preview); setOpen(true); }}>Add existing prompts</Button>
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
        {error && <p role="alert" className={styles.importError}>{error}</p>}
        {done && <>
          <div className={styles.formActions}>
            <Button variant="ghost" onClick={() => { setDone(null); setResult(''); }}>Import more</Button>
            <Button variant="primary" onClick={() => { const href = importedHref(done); close(); router.push(href); }}>
              {done.length === 1 ? 'Open imported prompt' : 'Open imported prompts'}
            </Button>
          </div>
        </>}
        {!preview && !done && <>
          <p className={styles.dialogText}>Paste a prompt, choose files or a whole folder, or drop them here. Notion and Obsidian notes work as exported. You can review everything before it is added. Importing copies your notes once; import them again later to add new ones or update prompts that changed.</p>
          {!files.length && <div className={styles.field}>
            <label htmlFor="import-source">Paste text</label>
            <textarea id="import-source" value={source} disabled={busy} onChange={event => { updateSource(event.target.value); if (fileTitle.current) { setNoteTitle(''); fileTitle.current = false; } }} rows={8}
              placeholder="For example: Summarize {{notes}} for {{team}} in three bullets." />
          </div>}
          <div className={styles.field}>
            <label htmlFor="import-file">Or choose files: .md, .txt, .csv, .json, or a Notion .zip export</label>
            <input id="import-file" type="file" multiple accept=".json,.md,.markdown,.txt,.csv,.zip" disabled={busy}
              onChange={event => { void readFiles([...event.target.files ?? []].map(file => ({ file, path: file.name })), false); event.target.value = ''; }} />
          </div>
          <div className={styles.field}>
            <label htmlFor="import-folder">Or choose a folder, such as an Obsidian vault</label>
            {/* The browser's own folder input says "Choose Files"; this button says what it does. */}
            <input ref={folderInput} id="import-folder" type="file" multiple hidden disabled={busy} {...{ webkitdirectory: '' }}
              onChange={event => { void readFiles([...event.target.files ?? []].map(file => ({ file, path: file.webkitRelativePath || file.name })), true); event.target.value = ''; }} />
            <Button variant="secondary" className={styles.fieldAction} disabled={busy} onClick={() => folderInput.current?.click()}>Choose folder</Button>
          </div>
          {files.length > 0 && <div className={styles.fileList} role="status">
            <p>{files.length} file{files.length === 1 ? '' : 's'} ready: {files.slice(0, 5).map(file => file.name).join(', ')}{files.length > 5 ? ` and ${files.length - 5} more` : ''}.</p>
            <Button variant="ghost" disabled={busy} onClick={() => { setFiles([]); setResult(''); }}>Clear files</Button>
          </div>}
          {!files.length && <div className={styles.field}>
            <label htmlFor="import-note-title">Title for a single note</label>
            <input id="import-note-title" value={noteTitle} onChange={event => setNoteTitle(event.target.value)} maxLength={100} placeholder="From the first line" disabled={busy} />
            <small>Used when the text has no # Title. You can change it in the preview.</small>
          </div>}
          <details className={styles.dialogText}>
            <summary>Format details</summary>
            <p>A note without a heading is kept in one Prompt section. Note metadata is tidied first: YAML front matter, Notion page properties and callouts, Obsidian callouts, comments, Dataview queries, embedded files and trailing #tags are removed, [[links]], links to other Notion pages and ==highlights== read as text, the front matter title or first heading becomes the title, the first tag suggests a folder, and a Notion favourite stays a favourite. Note templates and pages of only links start unticked. You can keep the original text in the preview.</p>
            <p>For several prompts in one note, start each with a heading and optionally add smaller headings for sections; a pasted page that starts at ## works the same way. Headings inside code fences remain text. Up to 1,000 prompts at a time.</p>
            <p>JSON files use the Prompt Maker Studio export format: titles, sections, folders, variable settings and favourites are copied. Version history, dates and notes are not imported; this is not a full archive restore.</p>
          </details>
          <Button variant="primary" disabled={busy || (!source.trim() && !files.length)} onClick={() => showPreview(keepOriginal)}>Preview</Button>
        </>}
        {preview && <>
          {resumed && <p role="status" className={styles.dialogText}>Your earlier import is still here.{' '}
            <Button variant="ghost" disabled={busy} onClick={startOver}>Start over</Button>
          </p>}
          <p className={styles.dialogText}>Review {plural(preview.length, 'prompt')} before importing. Untick any you don&apos;t want, and edit titles and folders; leave a folder empty for Unfiled.</p>
          {skipped.length > 0 && <div className={styles.importError}>
            <p>Skipped {plural(skipped.length, 'file')}:</p>
            <ul>{skipped.map(reason => <li key={reason}>{reason}</li>)}</ul>
          </div>}
          {problems > 0 && <p className={styles.importError}>{plural(problems, 'prompt')} need{problems === 1 ? 's' : ''} a change below before {problems === 1 ? 'it' : 'they'} can be imported.</p>}
          {fromNote && tidied && <label className={styles.checkRow}>
            <input type="checkbox" checked={keepOriginal} disabled={busy} onChange={event => { setKeepOriginal(event.target.checked); showPreview(event.target.checked); }} />
            Keep the original note text (front matter, page properties, callouts and tags)
          </label>}
          {preview.length > 1 && <>
            <div className={styles.field}>
              <label htmlFor="import-folder-all">Folder for all prompts</label>
              <input id="import-folder-all" value={sharedFolder} list="import-folders" maxLength={255} disabled={busy} placeholder={mixedFolders ? 'Different folders; type one to use for all' : 'Unfiled'}
                onChange={event => setPreview(preview.map(item => ({ ...item, folder: event.target.value })))} />
            </div>
            <div className={styles.selectionBar}>
              <Button variant="ghost" disabled={busy} onClick={() => setToggled([])}>Select all new</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setToggled(preview.flatMap((prompt, index) => startsUnticked(prompt) ? [] : [index]))}>Select none</Button>
            </div>
          </>}
          {placeholders.length > 0 && !beforeConvert && <fieldset className={styles.placeholderOffer}>
            <legend>Found {placeholders.length === 1 ? 'a placeholder' : `${placeholders.length} placeholders`}. Choose which become inputs you fill in:</legend>
            <div className={styles.placeholderChoices}>
              {placeholders.map(token => <label key={token}>
                <input type="checkbox" checked={!unchosen.includes(token)} disabled={busy}
                  onChange={event => setUnchosen(event.target.checked ? unchosen.filter(item => item !== token) : [...unchosen, token])} />
                <code>{token}</code>{preview.length > 1 && ` (${plural(usedIn(token), 'prompt')})`}
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
            {preview.map((prompt, index) => {
              const problem = importProblem(willSend(prompt, index));
              const first = preview.findIndex(other => sameTitle(other, prompt));
              const untitled = withoutTitleLine(prompt);
              return <div className={styles.importItem} key={index}>
                {isChanged(prompt) ? <fieldset className={styles.duplicateChoice}>
                  <legend>{updateTarget(prompt) ? 'Already in your library, with different text:' : `${matches(prompt).length} prompts in your library have this title, each with different text:`}</legend>
                  {([['skip', 'Leave it as it is'], ['update', 'Update it (the current text stays in History)'], ['copy', 'Import a copy']] as const).filter(([choice]) => choice !== 'update' || updateTarget(prompt)).map(([choice, label]) =>
                    <label key={choice} className={styles.checkRow}>
                      <input type="radio" name={`import-duplicate-${index}`} disabled={busy}
                        checked={choice === 'update' ? updating.includes(index) : choice === 'copy' ? ticked(prompt, index) && !updating.includes(index) : !ticked(prompt, index) && !updating.includes(index)}
                        onChange={() => {
                          setUpdating(choice === 'update' ? [...updating, index] : updating.filter(item => item !== index));
                          setToggled(choice === 'copy' ? [...toggled, index] : toggled.filter(item => item !== index));
                        }} />
                      {label}
                    </label>)}
                </fieldset> : <label className={styles.checkRow}>
                  <input type="checkbox" checked={ticked(prompt, index)} disabled={busy} onChange={() => toggle(index)} />
                  {isDuplicate(prompt) ? 'Already in your library. Import a copy anyway' : prompt.name.trim() ? `Import “${prompt.name.trim()}”` : `Import prompt ${index + 1}`}
                </label>}
                <div className={styles.field}>
                  <label htmlFor={`import-title-${index}`}>Title for prompt {index + 1}</label>
                  <input id={`import-title-${index}`} value={prompt.name} maxLength={100} disabled={busy} aria-invalid={!!importProblem({ ...prompt, fields: [] })}
                    aria-describedby={problem ? `import-problem-${index}` : undefined} onChange={event => edit(index, item => ({ ...item, name: event.target.value }))} />
                </div>
                <div className={styles.field}>
                  <label htmlFor={`import-folder-${index}`}>Folder for {prompt.name}</label>
                  <input id={`import-folder-${index}`} value={prompt.folder ?? ''} list="import-folders" maxLength={255} disabled={busy} onChange={event => edit(index, item => ({ ...item, folder: event.target.value }))} />
                </div>
                {untitled && <p className={styles.dialogText}>The text starts with its title.{' '}
                  <Button variant="ghost" disabled={busy} onClick={() => edit(index, () => untitled)}>Take it out of the text</Button>
                </p>}
                {first < index && <p className={styles.dialogText}>Same title as prompt {first + 1} in this import.</p>}
                {prompt.flag && <p className={styles.dialogText}>{prompt.flag}</p>}
                {problem && <div id={`import-problem-${index}`} className={styles.importError}>
                  <p>{problem}{/^Section/.test(problem) && ' Split it at paragraph breaks into numbered sections; no text is removed.'}</p>
                  {/^Section/.test(problem) && <Button variant="secondary" className={styles.fieldAction} disabled={busy} onClick={() => edit(index, item => splitLongSections(willSend(item, index)))}>Split section</Button>}
                </div>}
                <details open={preview.length <= 5}><summary>{prompt.fields.length} section{prompt.fields.length === 1 ? '' : 's'}</summary>{prompt.fields.map(field => <div key={field.name}><strong>{field.name}</strong><pre className={styles.importText}>{field.content}</pre></div>)}</details>
              </div>;
            })}
          </div>
          {singleNote && <p className={styles.dialogText}>Keep it as written, or let AI split it into sections and suggest inputs (needs an AI connection).</p>}
          <div className={styles.formActions}>
            <Button variant="ghost" disabled={busy} onClick={() => { setPreview(null); setBeforeConvert(null); setError(''); }}>Back</Button>
            {singleNote && <Button variant="secondary" disabled={busy} onClick={reuseWithAI}>Make reusable with AI</Button>}
            <Button variant="primary" disabled={busy || !(count + updateCount)} onClick={() => void importPrompts()}>
              {busy ? (count + updateCount > 1 ? `Importing ${progress} of ${count + updateCount}…` : 'Importing…')
                : !(count + updateCount) ? (preview.every(isDuplicate) ? 'Nothing new to import' : 'Nothing selected to import')
                : !count ? `Update ${plural(updateCount, 'prompt')}`
                : singleNote ? 'Keep as written'
                : `Import ${plural(count, 'prompt')}${updateCount ? ` and update ${updateCount}` : ''}`}
            </Button>
          </div>
        </>}
        <Button variant="ghost" disabled={busy} onClick={close}>Close</Button>
        <datalist id="import-folders">{folders.map(folder => <option key={folder} value={folder} />)}</datalist>
      </div>
    </Dialog>
  </>;
}
