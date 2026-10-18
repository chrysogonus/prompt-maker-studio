'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { ApiClient } from '@/lib/api';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import { libraryHref } from '@/lib/libraryViews';
import { ImportPrompt, MAX_IMPORT_BYTES, parsePromptImport, pasteHandoffKey, validateImportPrompts } from '@/lib/promptImport';
import type { PromptHistoryResponse } from '@/types/prompt';
import styles from './LibraryPage.module.css';

/** One prompt opens ready to use; several open where they were filed. */
function importedHref(created: PromptHistoryResponse[]): string {
  if (created.length === 1) return `/editor/${created[0].id}`;
  const folders = new Set(created.map((prompt) => prompt.folder));
  const [folder] = folders;
  return folders.size === 1 && folder ? libraryHref({ type: 'folder', folder }) : '/library';
}

export default function ImportPrompts({ onCreated, folders }: {
  onCreated: (prompts: PromptHistoryResponse[]) => void;
  folders: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const imported = useRef<PromptHistoryResponse[]>([]);
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
  const updateSource = (text: string) => { setSource(text); setPreview(null); setError(''); setResult(''); };
  // A fresh single note may go to AI conversion instead; retries and JSON exports may not.
  const singleNote = preview?.length === 1 && preview[0].fields.length === 1 && !!source.trim() && !/^[{[]/.test(source.trim());
  const importPrompts = async () => {
    let validated: ImportPrompt[];
    try { validated = validateImportPrompts(preview); } catch (error) { setError((error as Error).message); return; }
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
    setSource('');
    setDone(failed.length ? null : created);
    setResult(`Imported ${created.length} of ${validated.length} prompts.${failed.length ? ` ${failed.length} failed; only these remain below for retry.` : ''}`);
    setBusy(false);
  };
  const reuseWithAI = () => {
    try { sessionStorage.setItem(pasteHandoffKey(), preview![0].fields[0].content); } catch { /* The editor still opens Paste a prompt empty. */ }
    close();
    router.push('/editor/new?import=1');
  };
  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}>Add existing prompts</Button>
    <Dialog className={styles.importDialog} isOpen={open} title="Add existing prompts" onClose={close}>
      <div className={styles.form}>
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
          <p className={styles.dialogText}>Paste a prompt or choose a file. You can review everything before it is added; existing prompts are never replaced.</p>
          <div className={styles.field}>
            <label htmlFor="import-source">Paste text</label>
            <textarea id="import-source" value={source} disabled={busy} onChange={event => updateSource(event.target.value)} rows={8}
              placeholder="For example: Summarize {{notes}} for {{team}} in three bullets." />
          </div>
          <div className={styles.field}>
            <label htmlFor="import-file">Or choose a file (.md, .txt or .json, up to 5 MB)</label>
            <input id="import-file" type="file" accept=".json,.md,.markdown,.txt" disabled={busy} onChange={async event => {
              const file = event.target.files?.[0];
              if (!file) return;
              updateSource('');
              if (file.size > MAX_IMPORT_BYTES) { setError('Import files must be 5 MB or smaller.'); return; }
              setBusy(true);
              try { updateSource(await file.text()); setNoteTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 100)); } catch { setError('Could not read this file.'); }
              finally { setBusy(false); }
            }} />
          </div>
          <div className={styles.field}>
            <label htmlFor="import-note-title">Title for a single note</label>
            <input id="import-note-title" value={noteTitle} onChange={event => setNoteTitle(event.target.value)} maxLength={100} placeholder="Imported note" disabled={busy} />
            <small>Used when the text has no # Title. You can change it in the preview.</small>
          </div>
          <details className={styles.dialogText}>
            <summary>Format details</summary>
            <p>A single note is kept as written in one Prompt section. A simple YAML frontmatter title supplies the title; all frontmatter stays in the text and other YAML metadata is not mapped.</p>
            <p>For several prompts, start each with # Title and optionally add ## Section name headings. Headings inside code fences remain text. Up to 100 prompts at a time.</p>
            <p>JSON files use the Prompt Maker Studio export format: titles, sections, folders, variable settings and favorites are copied. Version history, dates and notes are not imported; this is not a full archive restore.</p>
          </details>
          <Button variant="primary" disabled={busy || !source.trim()} onClick={() => {
            try { setPreview(parsePromptImport(source, noteTitle)); setError(''); setResult(''); }
            catch (error) { setError((error as Error).message); }
          }}>Preview</Button>
        </>}
        {preview && <>
          <p className={styles.dialogText}>Review {preview.length} prompt{preview.length === 1 ? '' : 's'} before importing. Edit titles and folders below; leave a folder empty for Unfiled.</p>
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
              <details open={preview.length <= 5}><summary>{prompt.fields.length} section{prompt.fields.length === 1 ? '' : 's'}</summary>{prompt.fields.map(field => <div key={field.name}><strong>{field.name}</strong><pre className={styles.importText}>{field.content}</pre></div>)}</details>
            </div>)}
          </div>
          {singleNote && <p className={styles.dialogText}>Keep it as written, or let AI split it into sections and suggest inputs (needs an AI connection).</p>}
          <div className={styles.formActions}>
            <Button variant="ghost" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>Back</Button>
            {singleNote && <Button variant="secondary" disabled={busy} onClick={reuseWithAI}>Make reusable with AI</Button>}
            <Button variant="primary" disabled={busy} onClick={() => void importPrompts()}>{busy ? 'Importing…' : singleNote ? 'Keep as written' : `Import ${preview.length} prompt${preview.length === 1 ? '' : 's'}`}</Button>
          </div>
        </>}
        <Button variant="ghost" disabled={busy} onClick={close}>Close</Button>
        <datalist id="import-folders">{folders.map(folder => <option key={folder} value={folder} />)}</datalist>
      </div>
    </Dialog>
  </>;
}
