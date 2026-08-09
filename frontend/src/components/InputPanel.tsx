/**
 * Input panel component - left side of the interface
 * Manages the dynamic list of named fields that define the prompt structure.
 * Each field maps to a labeled section in the generated prompt output.
 */

'use client';

import { FormEvent } from 'react';
import React from 'react';
import { hasDuplicateFieldNames, sanitizeFieldName } from '@/lib/fieldNames';
import { FIELD_TEMPLATES } from '@/lib/fieldTemplates';
import { PromptField } from '@/types/prompt';
import styles from './InputPanel.module.css';

interface InputPanelProps {
  fields: PromptField[];
  onFieldsChange: (fields: PromptField[]) => void;
  onGenerate: () => void;
  isLoading: boolean;
}

export default function InputPanel({
  fields,
  onFieldsChange,
  onGenerate,
  isLoading,
}: InputPanelProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onGenerate();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canGenerate && !isLoading) {
      e.preventDefault();
      onGenerate();
    }
  };

  const handleAddField = () => {
    const newField: PromptField = {
      name: '',
      content: '',
    };
    onFieldsChange([...fields, newField]);
  };

  const handleLoadStarterKit = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const template = FIELD_TEMPLATES.find((t) => t.id === e.target.value);
    e.target.value = '';
    if (!template) return;
    onFieldsChange(template.fields.map((field) => ({ ...field })));
  };

  const handleRemoveField = (index: number) => {
    const newFields = fields.filter((_, i) => i !== index);
    onFieldsChange(newFields);
  };

  const handleMoveField = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    const newFields = [...fields];
    [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]];
    onFieldsChange(newFields);
  };

  const handleFieldNameChange = (index: number, name: string) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], name: sanitizeFieldName(name) };
    onFieldsChange(newFields);
  };

  const handleFieldContentChange = (index: number, content: string) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], content };
    onFieldsChange(newFields);
  };

  const hasDuplicateNames = hasDuplicateFieldNames(fields.map(f => f.name));
  const canGenerate = fields.length > 0 && fields.every(f => f.name && f.content) && !hasDuplicateNames;

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>Prompt Configuration</h2>
      
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className={styles.form}>
        {fields.map((field, index) => (
          <div key={index} className={styles.fieldContainer}>
            <div className={styles.fieldHeader}>
              <input
                type="text"
                value={field.name}
                onChange={(e) => handleFieldNameChange(index, e.target.value)}
                className={styles.fieldNameInput}
                placeholder="Field name (e.g., goal, setting)"
                // The placeholder disappears the moment there is a value, so it
                // cannot be the accessible name; these rows have no visible
                // label to point a <label for> at.
                aria-label={`Field ${index + 1} name`}
                pattern="[A-Za-z_][A-Za-z0-9_-]*"
                title="Use letters, numbers, underscores, or hyphens. Names must start with a letter or underscore."
                required
              />
              <div className={styles.moveButtonGroup}>
                <button
                  type="button"
                  onClick={() => handleMoveField(index, -1)}
                  className={styles.moveButton}
                  disabled={index === 0}
                  title="Move field up"
                  aria-label={`Move field ${index + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveField(index, 1)}
                  className={styles.moveButton}
                  disabled={index === fields.length - 1}
                  title="Move field down"
                  aria-label={`Move field ${index + 1} down`}
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveField(index)}
                className={styles.removeButton}
                title="Remove field"
                aria-label={`Remove field ${index + 1}`}
              >
                ×
              </button>
            </div>
            <textarea
              value={field.content}
              onChange={(e) => handleFieldContentChange(index, e.target.value)}
              className={styles.textarea}
              placeholder="Enter content for this field..."
              aria-label={field.name ? `${field.name} content` : `Field ${index + 1} content`}
              required
              rows={4}
            />
          </div>
        ))}

        <div className={styles.fieldActionsRow}>
          <button
            type="button"
            onClick={handleAddField}
            className={styles.addButton}
          >
            + Add Field
          </button>
          <select
            className={styles.starterKitSelect}
            value=""
            onChange={handleLoadStarterKit}
            aria-label="Load starter kit"
          >
            <option value="" disabled>
              Load starter kit…
            </option>
            {FIELD_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id} title={template.description}>
                {template.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className={styles.button}
          disabled={isLoading || !canGenerate}
          title={canGenerate ? 'Generate prompt (Ctrl+Enter / ⌘↵)' : undefined}
        >
          {isLoading ? 'Generating…' : 'Generate Prompt'}
        </button>
        {hasDuplicateNames && (
          <p className={styles.validationMessage} role="alert">
            Field names must be unique.
          </p>
        )}
      </form>
    </div>
  );
}
