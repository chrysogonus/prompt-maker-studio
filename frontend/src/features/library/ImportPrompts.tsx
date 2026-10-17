'use client';

import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { ApiClient } from '@/lib/api';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import { MAX_IMPORT_BYTES, parsePromptImport, validateImportPrompts } from '@/lib/promptImport';
import type { PromptCreateRequest, PromptHistoryResponse } from '@/types/prompt';
import styles from './LibraryPage.module.css';

export default function ImportPrompts({ onCreated, folders }: {
  onCreated: (prompts: PromptHistoryResponse[]) => void;
  folders: string[];
}) {
  const [open, setOpen] = useState(false);
  const imported = useRef<PromptHistoryResponse[]>([]);
  const close = () => {
    if (busy) return;
    setOpen(false);
    // Keep the empty-library dialog mounted until review/retries are finished.
    if (imported.current.length) { onCreated(imported.current); imported.current = []; }
  };
  const [source, setSource] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [preview, setPreview] = useState<PromptCreateRequest[] | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const updateSource = (text: string) => { setSource(text); setPreview(null); setError(''); setResult(''); };
  const importPrompts = async () => {
    let validated: PromptCreateRequest[];
    try { validated = validateImportPrompts(preview); } catch (error) { setError((error as Error).message); return; }
    setBusy(true);
    setError('');
    const created: PromptHistoryResponse[] = [];
    const failed: PromptCreateRequest[] = [];
    for (const prompt of validated) {
      try { created.push(await ApiClient.createPrompt(prompt)); }
      catch { failed.push(prompt); }
    }
    if (created.length) { imported.current.push(...created); notifyLibraryChanged(); }
    setPreview(failed.length ? failed : null);
    setSource('');
    setResult(`Imported ${created.length} of ${validated.length} prompts.${failed.length ? ` ${failed.length} failed; only these remain below for retry.` : ' Your new copies are in the library.'}`);
    setBusy(false);
  };
  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}>Import prompts</Button>
    <Dialog className={styles.importDialog} isOpen={open} title="Import prompts" onClose={close}>
      <div className={styles.form}>
        <p className={styles.dialogText}>Create new prompt copies from a JSON export, Markdown or a plain note. Existing prompts are never replaced. JSON imports copy current titles, sections, folders and variable metadata. Version history, dates, notes and favorites are not imported; this is not a full archive restore.</p>
        {result && <p role="status">{result}</p>}
        {error && <p role="alert">{error}</p>}
        {!preview && <>
          <div className={styles.field}>
            <label htmlFor="import-file">JSON or Markdown file (up to 5 MB, 100 prompts)</label>
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
            <label htmlFor="import-source">Paste Markdown or JSON</label>
            <textarea id="import-source" value={source} disabled={busy} onChange={event => updateSource(event.target.value)} rows={8} aria-describedby="import-format" />
            <small id="import-format">Single note: paste text or upload a .md or .txt file. Its content is kept in one Prompt section. Simple YAML frontmatter title values supply the title; all frontmatter stays in the text. Other YAML metadata is not mapped to folders, tags or settings. For multiple prompts, start each with # Title and optionally add ## Section name headings. Headings inside code fences remain text. JSON imports use the Prompt Maker Studio export format.</small>
          </div>
          <div className={styles.field}>
            <label htmlFor="import-note-title">Title for a single note</label>
            <input id="import-note-title" value={noteTitle} onChange={event => setNoteTitle(event.target.value)} maxLength={100} placeholder="Imported note" disabled={busy} />
            <small>Suggested from the filename; editable here and in preview. A # Title or simple YAML title takes precedence.</small>
          </div>
          <Button variant="primary" disabled={busy || !source.trim()} onClick={() => {
            try { setPreview(parsePromptImport(source, noteTitle)); setError(''); setResult(''); }
            catch (error) { setError((error as Error).message); }
          }}>Preview import</Button>
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
              <details><summary>{prompt.fields.length} section{prompt.fields.length === 1 ? '' : 's'}</summary>{prompt.fields.map(field => <div key={field.name}><strong>{field.name}</strong><pre className={styles.importText}>{field.content}</pre></div>)}</details>
            </div>)}
          </div>
          <div className={styles.formActions}>
            <Button variant="ghost" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>Back</Button>
            <Button variant="primary" disabled={busy} onClick={() => void importPrompts()}>{busy ? 'Importing…' : `Import ${preview.length} prompt${preview.length === 1 ? '' : 's'}`}</Button>
          </div>
        </>}
        <Button variant="ghost" disabled={busy} onClick={close}>Close</Button>
        <datalist id="import-folders">{folders.map(folder => <option key={folder} value={folder} />)}</datalist>
      </div>
    </Dialog>
  </>;
}
