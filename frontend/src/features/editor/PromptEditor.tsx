'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import Button, { ButtonLink } from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { EditIcon, FolderIcon } from '@/components/ui/icon';
import { PROMPT_NOT_FOUND_MESSAGE } from '@/lib/api';

import { STARTER_TEMPLATES } from '@/lib/starterTemplates';

import HistoryPanel from './HistoryPanel';
import ImportDialog from './ImportDialog';
import PreviewPane from './PreviewPane';
import RefinePanel from './RefinePanel';
import SectionCard from './SectionCard';
import VariablesPanel from './VariablesPanel';
import styles from './PromptEditor.module.css';
import { usePromptEditor } from './usePromptEditor';
import { toEditorSections, uniqueName, PromptEditorProps } from './editorState';

export default function PromptEditor({ promptId, initialStarter, initialMode, openImport }: PromptEditorProps) {
  const {
    router,
    isNew,
    prompt,
    promptRef,
    versions,
    sections,
    setSections,
    metadata,
    setMetadata,
    values,
    setValues,
    mode,
    setMode,
    mobileTab,
    setMobileTab,
    previewOpen,
    setPreviewOpen,
    historyOpen,
    setHistoryOpen,
    refineOpen,
    setRefineOpen,
    restoredDraft,
    loading,
    loadError,
    saving,
    note,
    setNote,
    conflict,
    notice,
    setNotice,
    draftAction,
    setDraftAction,
    saveDialog,
    setSaveDialog,
    moveDialog,
    setMoveDialog,
    folders,
    renaming,
    setRenaming,
    starterOpen,
    setStarterOpen,
    importOpen,
    setImportOpen,
    importSession,
    setImportSession,
    aiAvailable,
    aiConfig,
    aiConfigLoading,
    aiConfigError,
    importSections,
    showNotice,
    fields,
    variables,
    dirty,
    nameErrors,
    save,
    createPrompt,
    discardEdits,
    reloadAfterConflict,
    restore,
    rename,
    move,
    updateSection,
    moveSection,
    removeSection,
    replaceSections,
    applyRefinement,
  } = usePromptEditor({ promptId, initialStarter, initialMode, openImport });

  const editorRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const pasteButtonRef = useRef<HTMLButtonElement>(null);
  const [focusedUse, setFocusedUse] = useState(initialMode === 'filled');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    if (!toolsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setToolsOpen(false);
      toolsButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [toolsOpen]);
  const focusImported = useRef(false);
  useEffect(() => {
    if (!importOpen && focusImported.current) {
      focusImported.current = false;
      editorRef.current?.querySelector<HTMLElement>('[aria-label="Preview"] textarea, [aria-label="Prompt text"]')?.focus();
    }
  }, [importOpen]);

  if (loading) {
    return <div className={styles.status}>Loading prompt…</div>;
  }

  if (loadError) {
    const notFound = loadError === PROMPT_NOT_FOUND_MESSAGE;
    return (
      <div className={styles.loadError} role="alert">
        <h1>{notFound ? 'Prompt not found' : 'Could not load prompt'}</h1>
        <p>{loadError}</p>
        <Button variant="secondary" onClick={() => router.push('/library')}>
          Back to library
        </Button>
      </div>
    );
  }

  const hasContent = fields.some((field) => field.content.trim());

  return (
    <div ref={editorRef} className={styles.editor} data-tab={mobileTab} data-focused={focusedUse ? "true" : "false"}>
      <header className={styles.head}>
        <div className={styles.crumbs}>
          {prompt && (
            <>
              <button
                type="button"
                className={styles.crumbFolder}
                onClick={() => setMoveDialog(prompt.folder ?? '')}
                title="Move to folder"
              >
                <FolderIcon size={14} tone="inherit" className={styles.crumbIcon} />
                {prompt.folder || 'Unfiled'}
              </button>
              <span className={styles.crumbSep} aria-hidden="true">
                /
              </span>
            </>
          )}
          {prompt && renaming ? (
            <input
              className={styles.renameInput}
              defaultValue={prompt.name ?? ''}
              aria-label="Prompt name"
              maxLength={100}
              autoFocus
              onBlur={(e) => rename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : prompt ? (
            <button
              type="button"
              className={styles.title}
              onClick={() => setRenaming(true)}
              title="Rename"
            >
              <span className={styles.titleText}>{prompt.name}</span>
              <EditIcon size={14} className={styles.titleIcon} />
            </button>
          ) : (
            <h1 className={styles.title}>New prompt</h1>
          )}
          {dirty && <span className={styles.edited}>Edited</span>}
        </div>
        <div className={styles.headActions}>
          {focusedUse && <Button variant="secondary" onClick={() => { setFocusedUse(false); setMobileTab('edit'); }}>Edit template</Button>}
          {!focusedUse && prompt && <Button className={styles.useButton} variant="secondary" onClick={() => { setFocusedUse(true); setMobileTab('use'); setPreviewOpen(true); }}>Fill and copy</Button>}
          {prompt && dirty && (
            <input
              className={styles.noteInput}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What changed? (optional)"
              aria-label="Version note"
              maxLength={255}
            />
          )}
          {prompt && dirty && (
            <Button variant="ghost" onClick={discardEdits} disabled={refineOpen}>
              Discard
            </Button>
          )}
          {!focusedUse && <Button
            variant="ghost"
            aria-pressed={refineOpen}
            disabled={saving || !hasContent || nameErrors.some(Boolean)}
            onClick={() => { setFocusedUse(false); setMobileTab('edit'); setHistoryOpen(false); setRefineOpen((open) => !open); }}
          >
            Refine
          </Button>}
          {prompt && <div className={styles.tools} ref={toolsRef} onBlur={(event) => {
            // Safari doesn't focus clicked buttons, so a null relatedTarget is a
            // click inside the menu; outside clicks are handled on pointerdown.
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setToolsOpen(false);
          }}>
            <Button ref={toolsButtonRef} variant="secondary" aria-expanded={toolsOpen} aria-controls="editor-tools" onClick={() => setToolsOpen((open) => !open)}>
              Tools <ChevronDown size={14} aria-hidden="true" />
            </Button>
            {toolsOpen && <div id="editor-tools" className={styles.toolsMenu}>
              <Button variant="ghost" onClick={() => { setToolsOpen(false); setDetailsOpen(true); }}>Prompt details</Button>
              {!dirty && !saving ? (
                <ButtonLink variant="ghost" href={`/editor/${prompt.id}/evaluate`} onClick={() => setToolsOpen(false)}>Evaluate</ButtonLink>
              ) : (
                <Button variant="ghost" disabled title="Save your changes before evaluating.">Evaluate</Button>
              )}
              <Button variant="ghost" disabled={refineOpen || saving} onClick={() => { setToolsOpen(false); setImportOpen(true); }}>Paste a prompt</Button>
              <Button variant="ghost" onClick={() => {
                setToolsOpen(false);
                setRefineOpen(false);
                if (historyOpen) toolsButtonRef.current?.focus();
                setHistoryOpen((open) => !open);
              }} aria-pressed={historyOpen}>History</Button>
            </div>}
          </div>}
          {(!focusedUse || dirty) && <Button variant="primary" onClick={save} disabled={saving || refineOpen || (!!prompt && !dirty)}>
            {saving ? 'Saving…' : prompt && !dirty ? 'Saved' : 'Save'}
          </Button>}
        </div>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Editor mode">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'edit'}
          onClick={() => setMobileTab('edit')}
        >
          Edit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'use'}
          onClick={() => setMobileTab('use')}
        >
          Fill and copy
        </button>
      </div>

      {draftAction && <div className={styles.banner} role="status">
        <span>{draftAction.text}</span>
        <Button variant="secondary" disabled={refineOpen || saving} onClick={() => {
          setDraftAction(null);
          draftAction.action?.run();
        }}>Undo</Button>
      </div>}

      {conflict && (
        <div className={`${styles.banner} ${styles.conflict}`} role="alert">
          <span>
            This prompt was changed somewhere else since you opened it. Your edits are still here.
          </span>
          <Button variant="secondary" onClick={reloadAfterConflict}>
            Load latest version
          </Button>
        </div>
      )}

      {restoredDraft && (
        <div className={styles.banner} role="status">
          <span>Your unsaved changes were restored.</span>
          <span>This draft is stored only in this browser.</span>
          <button type="button" className={styles.link} onClick={discardEdits}>Discard changes</button>
        </div>
      )}

      <div className={styles.body} data-preview={previewOpen || refineOpen ? 'open' : 'closed'}>
        <fieldset className={styles.write} hidden={focusedUse} disabled={refineOpen}>
          {isNew && (
            <div className={styles.startRow}>
              <div
                className={styles.menuWrap}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' || !starterOpen) return;
                  setStarterOpen(false);
                  e.currentTarget.querySelector('button')?.focus();
                }}
              >
                <Button
                  variant="ghost"
                  onClick={() => setStarterOpen((open) => !open)}
                  aria-expanded={starterOpen}
                >
                  Starter templates
                </Button>
                {starterOpen && (
                  <div className={styles.menu}>
                    {hasContent && (
                      <p className={styles.menuNote}>Choosing a template replaces your sections.</p>
                    )}
                    {STARTER_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className={styles.menuItem}
                        onClick={() => {
                          replaceSections(template.sections);
                          setStarterOpen(false);
                        }}
                      >
                        <strong>{template.label}</strong>
                        <span>{template.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button ref={pasteButtonRef} variant="ghost" onClick={() => setImportOpen(true)}>
                Paste a prompt
              </Button>
            </div>
          )}

          <div className={styles.sections}>
            {sections.map((section, index) => (
              <SectionCard
                key={section.key}
                section={section}
                index={index}
                count={sections.length}
                nameError={nameErrors[index]}
                onChange={(change) => updateSection(section.key, change)}
                onMove={(offset) => moveSection(index, offset)}
                onRemove={() => removeSection(index)}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.addSection}
            onClick={() =>
              setSections((current) => [
                ...current,
                ...toEditorSections([{ name: uniqueName(current), content: '' }], false),
              ])
            }
          >
            Add section
          </button>

          <VariablesPanel
            variables={variables}
            metadata={metadata}
            onDescribe={(name, description) =>
              setMetadata((current) => {
                // Clear only the hint; requirements and examples belong to the same variable.
                const saved = promptRef.current?.variable_metadata?.[name];
                const next = { ...current };
                const item = { ...saved, ...current[name], type: current[name]?.type ?? saved?.type ?? 'text', description: description || null };
                if (!saved && !description && !item.required && !item.example) {
                  delete next[name];
                } else {
                  next[name] = item;
                }
                return next;
              })
            }
            onChangeMetadata={(name, change) => setMetadata((current) => ({
              ...current, [name]: { ...current[name], type: current[name]?.type ?? 'text', ...change },
            }))}
            onRemove={(name) =>
              setMetadata((current) => {
                const next = { ...current };
                delete next[name];
                return next;
              })
            }
          />
        </fieldset>

        {!refineOpen && (
        <PreviewPane
          fields={fields}
          aiConfig={aiConfig}
          aiConfigLoading={aiConfigLoading}
          aiConfigError={aiConfigError}
          variables={variables}
          metadata={metadata}
          values={values}
          onClearValues={() => setValues({})}
          onLoadExamples={() => setValues((current) => ({
            ...current, ...Object.fromEntries(variables.filter((name) => metadata[name]?.example).map((name) => [name, metadata[name].example!])),
          }))}
          onValueChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
          mode={mode}
          onModeChange={setMode}
          open={previewOpen}
          onToggle={() => setPreviewOpen((open) => !open)}
          onCopyFailed={() =>
            showNotice({ text: 'Copying failed. Select the text and copy it instead.', tone: 'error' })
          }
        />
        )}

        <RefinePanel
          open={refineOpen}
          fields={fields}
          aiAvailable={aiAvailable}
          aiConfig={aiConfig}
          aiConfigLoading={aiConfigLoading}
          aiConfigError={aiConfigError}
          onClose={() => setRefineOpen(false)}
          onApply={applyRefinement}
        />

        {historyOpen && prompt && (
          <HistoryPanel
            current={prompt}
            versions={versions}
            dirty={dirty}
            onClose={() => { setHistoryOpen(false); toolsButtonRef.current?.focus(); }}
            onRestore={restore}
          />
        )}
      </div>

      <Dialog
        isOpen={!!saveDialog}
        title="Save prompt"
        onClose={() => {
          if (!saving) setSaveDialog(null);
        }}
      >
        {saveDialog && (
          <form className={styles.dialogForm} onSubmit={createPrompt}>
            <label className={styles.field}>
              <span>Name</span>
              <input
                value={saveDialog.name}
                onChange={(e) => setSaveDialog({ ...saveDialog, name: e.target.value, error: '' })}
                placeholder="For example: Weekly status update"
                maxLength={100}
                autoFocus
              />
            </label>
            <div className={styles.field}>
              <label htmlFor="save-folder">Folder</label>
              <input
                id="save-folder"
                value={saveDialog.folder}
                onChange={(e) => setSaveDialog({ ...saveDialog, folder: e.target.value })}
                list="editor-folders"
                placeholder="Unfiled"
                maxLength={255}
                aria-describedby="save-folder-hint"
              />
              <small id="save-folder-hint">Pick a folder or type a new name.</small>
            </div>
            {saveDialog.error && (
              <p className={styles.formError} role="alert">
                {saveDialog.error}
              </p>
            )}
            <div className={styles.dialogActions}>
              <Button variant="ghost" onClick={() => setSaveDialog(null)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save prompt'}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog isOpen={moveDialog !== null} title="Move to folder" onClose={() => setMoveDialog(null)}>
        <form className={styles.dialogForm} onSubmit={move}>
          <div className={styles.field}>
            <label htmlFor="move-folder">Folder</label>
            <input
              id="move-folder"
              value={moveDialog ?? ''}
              onChange={(e) => setMoveDialog(e.target.value)}
              list="editor-folders"
              placeholder="Unfiled"
              maxLength={255}
              aria-describedby="move-folder-hint"
              autoFocus
            />
            <small id="move-folder-hint">
              Leave empty to keep it unfiled. Type a new name to create a folder.
            </small>
          </div>
          <div className={styles.dialogActions}>
            <Button variant="ghost" onClick={() => setMoveDialog(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Move
            </Button>
          </div>
        </form>
      </Dialog>

      <datalist id="editor-folders">
        {folders.map((folder) => (
          <option key={folder} value={folder} />
        ))}
      </datalist>

      {/* A toast, so a status message never pushes the sections around. */}
      {notice && (
        <div className={styles.notice} role="status" data-tone={notice.tone}>
          {notice.text}
          {notice.action && (
            <button
              type="button"
              className={styles.noticeAction}
              onClick={() => {
                setNotice(null);
                notice.action!.run();
              }}
            >
              {notice.action.label}
            </button>
          )}
        </div>
      )}

      <Dialog isOpen={detailsOpen} title="Prompt details" onClose={() => setDetailsOpen(false)}>
        <dl className={styles.promptDetails}>
          <dt>Name</dt><dd>{prompt?.name}</dd>
          <dt>Folder</dt><dd>{prompt?.folder || 'Unfiled'}</dd>
        </dl>
        <Button onClick={() => setDetailsOpen(false)}>Close</Button>
      </Dialog>

      <ImportDialog
        isOpen={importOpen}
        aiAvailable={aiAvailable}
        aiConfig={aiConfig}
        aiConfigLoading={aiConfigLoading}
        aiConfigError={aiConfigError}
        replacesContent={hasContent}
        onClose={() => { setImportOpen(false); (prompt ? toolsButtonRef : pasteButtonRef).current?.focus(); }}
        session={importSession}
        onSessionChange={setImportSession}
        onImport={(result) => {
          focusImported.current = true;
          importSections(result);
        }}
      />
    </div>
  );

}

export type { EditorSection } from './editorState';
