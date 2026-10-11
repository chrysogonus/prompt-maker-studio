'use client';

import Button, { ButtonLink } from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
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

export default function PromptEditor({ promptId, initialStarter, openImport }: PromptEditorProps) {
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
    aiAvailable,
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
  } = usePromptEditor({ promptId, initialStarter, openImport });

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
    <div className={styles.editor} data-tab={mobileTab}>
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
              {prompt.name}
            </button>
          ) : (
            <h1 className={styles.title}>New prompt</h1>
          )}
          {dirty && <span className={styles.edited}>Edited</span>}
        </div>
        <div className={styles.headActions}>
          {prompt && !dirty && !saving ? (
            <ButtonLink variant="ghost" href={`/editor/${prompt.id}/evaluate`}>Evaluate</ButtonLink>
          ) : (
            <Button variant="ghost" disabled title={prompt ? 'Save your changes before evaluating.' : 'Save this prompt before evaluating.'}>
              Evaluate
            </Button>
          )}
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
          <Button
            variant="ghost"
            aria-pressed={refineOpen}
            disabled={saving || !hasContent || nameErrors.some(Boolean)}
            onClick={() => { setHistoryOpen(false); setRefineOpen((open) => !open); }}
          >
            Refine
          </Button>
          {prompt && (
            <Button
              variant="ghost"
              onClick={() => { setRefineOpen(false); setHistoryOpen((open) => !open); }}
              aria-pressed={historyOpen}
            >
              History
            </Button>
          )}
          <Button variant="primary" onClick={save} disabled={saving || refineOpen || (!!prompt && !dirty)}>
            {saving ? 'Saving…' : prompt && !dirty ? 'Saved' : 'Save'}
          </Button>
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

      <div className={styles.body} data-preview={previewOpen || refineOpen ? 'open' : 'closed'}>
        <fieldset className={styles.write} disabled={refineOpen}>
          {isNew && (
            <div className={styles.startRow}>
              <div className={styles.menuWrap}>
                <Button
                  variant="ghost"
                  onClick={() => setStarterOpen((open) => !open)}
                  aria-expanded={starterOpen}
                  aria-haspopup="menu"
                >
                  Starter templates
                </Button>
                {starterOpen && (
                  <div
                    className={styles.menu}
                    role="menu"
                    onKeyDown={(e) => e.key === 'Escape' && setStarterOpen(false)}
                  >
                    {hasContent && (
                      <p className={styles.menuNote}>Choosing a template replaces your sections.</p>
                    )}
                    {STARTER_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        role="menuitem"
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
              <Button variant="ghost" onClick={() => setImportOpen(true)}>
                Import text
              </Button>
            </div>
          )}

          {restoredDraft && (
            <div className={styles.banner}>
              <span>Your unsaved changes were restored.</span>
              <button type="button" className={styles.link} onClick={discardEdits}>
                Discard changes
              </button>
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
                // Clearing a hint returns to what was saved, so typing and
                // deleting one doesn't leave the prompt marked as edited.
                const saved = promptRef.current?.variable_metadata?.[name];
                const next = { ...current };
                if (description) {
                  next[name] = { type: current[name]?.type ?? saved?.type ?? 'text', description };
                } else if (saved) {
                  next[name] = { ...saved, description: null };
                } else {
                  delete next[name];
                }
                return next;
              })
            }
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
          variables={variables}
          metadata={metadata}
          values={values}
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
          onClose={() => setRefineOpen(false)}
          onApply={applyRefinement}
        />

        {historyOpen && prompt && (
          <HistoryPanel
            current={prompt}
            versions={versions}
            dirty={dirty}
            onClose={() => setHistoryOpen(false)}
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

      <ImportDialog
        isOpen={importOpen}
        aiAvailable={aiAvailable}
        replacesContent={hasContent}
        onClose={() => setImportOpen(false)}
        onImport={(imported) => {
          replaceSections(imported);
          setImportOpen(false);
          showNotice({
            text: `Imported ${imported.length} section${imported.length === 1 ? '' : 's'}. Review and rename them as needed.`,
          });
        }}
      />
    </div>
  );

}

export type { EditorSection } from './editorState';
