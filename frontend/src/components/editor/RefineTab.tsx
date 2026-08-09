/**
 * The Editor Detail "Refine" tab: AI-generated clarifying questions about
 * an underspecified prompt, then an AI-drafted revision shown as a
 * word-level diff, which the user can accept (saves as a new version) or
 * discard.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button';
import Textarea from '../ui/Textarea';
import { ApiClient } from '@/lib/api';
import { diffWords } from '@/lib/diff';
import { PromptHistoryResponse } from '@/types/prompt';
import styles from './RefineTab.module.css';
import { storageKey as namespacedKey } from '@/lib/branding';
import { useAuth } from '@/lib/auth-context';
import {
  ActionCompleteIcon,
  ErrorStatusIcon,
  LoadingIcon,
  RefineIcon,
  SuccessStatusIcon,
} from '../ui/icon';

const DIFF_CLASS: Record<'added' | 'removed' | 'unchanged', string> = {
  added: styles.diffAdded,
  removed: styles.diffRemoved,
  unchanged: styles.diffUnchanged,
};

const WORKFLOW_STEPS = [
  { label: 'Analyze', detail: 'Find missing context' },
  { label: 'Clarify', detail: 'Shape the intent' },
  { label: 'Review', detail: 'Approve every change' },
] as const;

interface RefineTabProps {
  prompt: PromptHistoryResponse;
  onAccepted: (draft: string) => void | Promise<void>;
}

const INSTRUCTION_LIKE_ANSWER = /\b(ignore|disregard|forget)\b.{0,40}\b(instruction|prompt|previous)\b|\b(system prompt|write (a )?poem|act as)\b/i;

export default function RefineTab({ prompt, onAccepted }: RefineTabProps) {
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState<string | null>(null);
  const [editedDraft, setEditedDraft] = useState<string>('');
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [isWellSpecified, setIsWellSpecified] = useState(false);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [error, setError] = useState('');
  const [approvedInstructionAnswers, setApprovedInstructionAnswers] = useState<Record<number, boolean>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [lastAcceptedOriginal, setLastAcceptedOriginal] = useState<string | null>(null);
  const restoredRef = useRef(false);
  const { currentUser } = useAuth();
  // Scoped by username as well as prompt id — see the same note in EditorDetail.
  const storageKey = currentUser ? namespacedKey(`refine:${currentUser}:${prompt.id}`) : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as {
          template?: string;
          questions?: string[];
          answers?: Record<number, string>;
          draft?: string | null;
          editedDraft?: string;
          isEditingDraft?: boolean;
          isWellSpecified?: boolean;
          approvedInstructionAnswers?: Record<number, boolean>;
        };
        if (saved.template !== prompt.generated_prompt) {
          localStorage.removeItem(storageKey);
          return;
        }
        setQuestions(saved.questions ?? []);
        setAnswers(saved.answers ?? {});
        setDraft(saved.draft ?? null);
        setEditedDraft(saved.editedDraft ?? saved.draft ?? '');
        setIsEditingDraft(saved.isEditingDraft ?? false);
        setIsWellSpecified(saved.isWellSpecified ?? false);
        setApprovedInstructionAnswers(saved.approvedInstructionAnswers ?? {});
      }
    } catch {
      localStorage.removeItem(storageKey);
    } finally {
      restoredRef.current = true;
    }
  }, [prompt.generated_prompt, storageKey]);

  useEffect(() => {
    if (!restoredRef.current || !storageKey) return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        template: prompt.generated_prompt,
        questions,
        answers,
        draft,
        editedDraft,
        isEditingDraft,
        isWellSpecified,
        approvedInstructionAnswers,
      }),
    );
  }, [answers, approvedInstructionAnswers, draft, editedDraft, isEditingDraft, isWellSpecified, prompt.generated_prompt, questions, storageKey]);

  const handleAskForClarification = async (force = false) => {
    setIsLoadingQuestions(true);
    setError('');
    try {
      const { questions: qs } = await ApiClient.getRefineQuestions(prompt.id, { force });
      if (qs.length === 0) {
        setIsWellSpecified(true);
      } else {
        setIsWellSpecified(false);
      }
      setQuestions(qs);
      setAnswers({});
      setApprovedInstructionAnswers({});
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate questions.');
    } finally {
      setIsLoadingQuestions(false);
    }
  };

  const suspiciousAnswerIndexes = useMemo(
    () =>
      questions
        .map((_, index) => index)
        .filter((index) => INSTRUCTION_LIKE_ANSWER.test(answers[index] ?? '')),
    [answers, questions],
  );
  const canGenerateDraft =
    questions.length > 0 &&
    questions.every((_, i) => (answers[i] ?? '').trim().length > 0) &&
    suspiciousAnswerIndexes.every((index) => approvedInstructionAnswers[index]);
  const pendingReviewCount = suspiciousAnswerIndexes.filter(
    (index) => !approvedInstructionAnswers[index],
  ).length;
  const answeredCount = questions.filter((_, index) => (answers[index] ?? '').trim()).length;
  const workflowStage = draft !== null ? 2 : questions.length > 0 ? 1 : 0;

  const handleGenerateDraft = async () => {
    setIsGeneratingDraft(true);
    setError('');
    try {
      const qaPairs = questions.map((question, i) => ({ question, answer: answers[i] ?? '' }));
      const { draft: generated } = await ApiClient.getRefineDraft(prompt.id, { qa_pairs: qaPairs });
      setDraft(generated);
      setEditedDraft(generated);
      setIsEditingDraft(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate a draft.');
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handleAccept = async () => {
    if (!draft) return;
    const original = prompt.generated_prompt;
    await onAccepted(editedDraft);
    setLastAcceptedOriginal(original);
    setSuccessMessage('Refinement accepted and saved.');
    setQuestions([]);
    setAnswers({});
    setDraft(null);
    setIsWellSpecified(false);
    if (storageKey) localStorage.removeItem(storageKey);
  };

  const handleDiscard = () => {
    setDraft(null);
  };

  const handleUndo = async () => {
    if (!lastAcceptedOriginal) return;
    await onAccepted(lastAcceptedOriginal);
    setLastAcceptedOriginal(null);
    setSuccessMessage('Refinement undone.');
  };

  const diffRows = draft ? diffWords(prompt.generated_prompt, editedDraft) : [];

  return (
    <div className={styles.container}>
      <section className={styles.hero} aria-labelledby="refine-title">
        <div className={styles.heroHeader}>
          <span className={styles.heroIcon}>
            <RefineIcon size="lg" tone="accent" />
          </span>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>AI-assisted refinement</span>
            <h2 id="refine-title" className={styles.title}>Make this prompt sharper</h2>
            <p className={styles.subtitle}>
              Surface missing context, clarify your intent, and shape a stronger prompt without
              giving up control.
            </p>
          </div>
          {!isWellSpecified && questions.length === 0 && (
            <Button
              variant="primary"
              className={styles.heroAction}
              onClick={() => handleAskForClarification()}
              disabled={isLoadingQuestions}
            >
              {isLoadingQuestions ? (
                <LoadingIcon tone="inherit" />
              ) : (
                <RefineIcon tone="inherit" />
              )}
              Ask for clarification
            </Button>
          )}
        </div>

        <ol className={styles.workflow} aria-label="Refinement progress">
          {WORKFLOW_STEPS.map((step, index) => {
            const state =
              isWellSpecified && questions.length === 0
                ? index === 0
                  ? 'complete'
                  : 'upcoming'
                : index < workflowStage
                  ? 'complete'
                  : index === workflowStage
                    ? 'active'
                    : 'upcoming';
            return (
              <li
                key={step.label}
                className={styles.workflowStep}
                data-state={state}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                <span className={styles.stepMarker}>
                  {state === 'complete' ? (
                    <ActionCompleteIcon size="sm" tone="inherit" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className={styles.stepCopy}>
                  <span className={styles.stepLabel}>{step.label}</span>
                  <span className={styles.stepDetail}>{step.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <ErrorStatusIcon tone="danger" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className={styles.successBanner} role="status" aria-live="polite">
          <span className={styles.bannerMessage}>
            <SuccessStatusIcon tone="success" />
            {successMessage}
          </span>
          {lastAcceptedOriginal && <Button variant="secondary" onClick={handleUndo}>Undo</Button>}
        </div>
      )}

      {isLoadingQuestions && (
        <div className={styles.analysisState} role="status" aria-live="polite">
          <div className={styles.analysisVisual} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <h3>Reading your prompt closely…</h3>
            <p>Looking for gaps in audience, tone, format, context, and constraints.</p>
          </div>
        </div>
      )}

      {!isLoadingQuestions && !isWellSpecified && questions.length === 0 && (
        <section className={styles.startCard} aria-labelledby="refine-start-title">
          <div className={styles.startCopy}>
            <h3 id="refine-start-title">A quick conversation, a more precise result</h3>
            <p>
              The refiner reads your current prompt and asks only what is genuinely missing.
              You review the final proposal before anything changes.
            </p>
          </div>
          <div className={styles.benefitGrid}>
            <div className={styles.benefit}>
              <span className={styles.benefitIcon} aria-hidden="true">01</span>
              <span><strong>Find blind spots</strong> in requirements and context</span>
            </div>
            <div className={styles.benefit}>
              <span className={styles.benefitIcon} aria-hidden="true">02</span>
              <span><strong>Keep your intent</strong> while improving precision</span>
            </div>
            <div className={styles.benefit}>
              <span className={styles.benefitIcon} aria-hidden="true">03</span>
              <span><strong>Stay in control</strong> with an editable diff</span>
            </div>
          </div>
          <div className={styles.safetyNote}>
            <span className={styles.safetyIcon}>
              <ActionCompleteIcon size="sm" tone="inherit" />
            </span>
            No automatic edits — your current prompt stays untouched until you accept.
          </div>
        </section>
      )}

      {!isLoadingQuestions && isWellSpecified && questions.length === 0 && (
        <div className={styles.wellSpecifiedState} role="status">
          <span className={styles.wellSpecifiedIcon}>
            <SuccessStatusIcon size="lg" tone="inherit" />
          </span>
          <div className={styles.wellSpecifiedCopy}>
            <h3>This prompt is already well-specified</h3>
            <p>No important gaps were found. You can still ask for optional improvement ideas.</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => handleAskForClarification(true)}
            disabled={isLoadingQuestions}
          >
            Ask anyway
          </Button>
        </div>
      )}

      {questions.length > 0 && draft === null && (
        <section className={styles.clarifySection} aria-labelledby="clarify-title">
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionEyebrow}>Step 2 of 3</span>
              <h3 id="clarify-title">Clarify the intent</h3>
              <p>Your answers become the brief for the refined version.</p>
            </div>
            <span className={styles.progressCount}>
              <strong>{answeredCount}</strong> / {questions.length} answered
            </span>
          </div>

          <div className={styles.qaList}>
            {questions.map((question, i) => (
              <div key={`${i}-${question}`} className={styles.qaItem}>
                <div className={styles.questionRow}>
                  <span className={styles.questionNumber}>{String(i + 1).padStart(2, '0')}</span>
                  <label className={styles.questionText} htmlFor={`answer-input-${i}`}>
                    {question}
                  </label>
                  {(answers[i] ?? '').trim() && (
                    <span className={styles.answeredMark} aria-label="Answered">
                      <ActionCompleteIcon size="sm" tone="inherit" />
                    </span>
                  )}
                </div>
                <Textarea
                  id={`answer-input-${i}`}
                  className={styles.answerInput}
                  value={answers[i] ?? ''}
                  onChange={(e) => {
                    setAnswers((prev) => ({ ...prev, [i]: e.target.value }));
                    setApprovedInstructionAnswers((prev) => ({ ...prev, [i]: false }));
                  }}
                  rows={3}
                  placeholder="Your answer…"
                  aria-invalid={!(answers[i] ?? '').trim()}
                />
                {suspiciousAnswerIndexes.includes(i) && !approvedInstructionAnswers[i] && (
                  <div className={styles.answerWarning} role="alert">
                    <span className={styles.answerWarningMessage}>
                      <ErrorStatusIcon tone="danger" />
                      This answer looks like an instruction rather than clarification.
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => setApprovedInstructionAnswers((prev) => ({ ...prev, [i]: true }))}
                    >
                      Use as clarification
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className={styles.generatePanel}>
            <div className={styles.generateStatus}>
              <div className={styles.progressTrack} aria-hidden="true">
                <span style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
              </div>
              <div className={styles.validationHint} role="status">
                {canGenerateDraft
                  ? 'Your refinement brief is ready.'
                  : pendingReviewCount > 0
                    ? `${pendingReviewCount} answer${pendingReviewCount === 1 ? '' : 's'} ${pendingReviewCount === 1 ? 'needs' : 'need'} review — confirm “Use as clarification” to continue.`
                    : `Answer all questions to continue (${answeredCount}/${questions.length} answered).`}
              </div>
            </div>
            <Button
              variant="primary"
              onClick={handleGenerateDraft}
              disabled={!canGenerateDraft || isGeneratingDraft}
              className={styles.generateButton}
            >
              {isGeneratingDraft ? (
                <LoadingIcon tone="inherit" />
              ) : (
                <RefineIcon tone="inherit" />
              )}
              Generate suggestion
            </Button>
          </div>
        </section>
      )}

      {draft !== null && (
        <section className={styles.draftSection} aria-labelledby="review-title">
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionEyebrow}>Step 3 of 3</span>
              <h3 id="review-title">Review your refined prompt</h3>
              <p>Inspect the changes or edit the proposal directly before accepting it.</p>
            </div>
            <span className={styles.reviewBadge}>Not saved yet</span>
          </div>

          <details className={styles.answersSummary}>
            <summary>
              <span>Refinement brief</span>
              <span className={styles.summaryMeta}>{questions.length} answers · edit &amp; regenerate</span>
            </summary>
            <div className={styles.answersSummaryBody}>
              {questions.map((question, index) => (
                <label key={`${index}-${question}`} className={styles.answerSummaryItem}>
                  <span>{question}</span>
                  <Textarea
                    value={answers[index] ?? ''}
                    onChange={(event) => setAnswers((prev) => ({ ...prev, [index]: event.target.value }))}
                    rows={2}
                  />
                </label>
              ))}
              <Button
                variant="secondary"
                className={styles.regenerateButton}
                onClick={handleGenerateDraft}
                disabled={!canGenerateDraft || isGeneratingDraft}
              >
                {isGeneratingDraft && <LoadingIcon />}
                Regenerate with these answers
              </Button>
            </div>
          </details>

          <div className={styles.proposalCard}>
            <div className={styles.proposalToolbar}>
              <div>
                <span className={styles.sectionLabel}>Proposed changes</span>
                {!isEditingDraft && (
                  <span className={styles.diffLegend}>
                    <span><i className={styles.addedSwatch} />Added</span>
                    <span><i className={styles.removedSwatch} />Removed</span>
                  </span>
                )}
              </div>
              <div className={styles.viewToggle} aria-label="Proposal view">
                <button
                  type="button"
                  data-active={!isEditingDraft}
                  aria-pressed={!isEditingDraft}
                  onClick={() => setIsEditingDraft(false)}
                >
                  View diff
                </button>
                <button
                  type="button"
                  data-active={isEditingDraft}
                  aria-pressed={isEditingDraft}
                  onClick={() => setIsEditingDraft(true)}
                >
                  Edit draft
                </button>
              </div>
            </div>
            {isEditingDraft ? (
              <Textarea
                value={editedDraft}
                onChange={(e) => setEditedDraft(e.target.value)}
                className={styles.diffBox}
                rows={14}
                mono
                aria-label="Edit proposed prompt"
              />
            ) : (
              <div className={styles.diffBox} aria-label="Proposed changes diff" tabIndex={0}>
                {diffRows.map((token, i) => (
                  <span key={i} className={DIFF_CLASS[token.type]}>
                    {token.text}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className={styles.draftFooter}>
            <span className={styles.safetyNoteCompact}>
              <ActionCompleteIcon size="sm" tone="success" /> You can undo after saving
            </span>
            <div className={styles.draftActions}>
              <Button variant="secondary" onClick={handleDiscard}>
                Discard
              </Button>
              <Button variant="primary" onClick={handleAccept}>
                Accept &amp; update prompt
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
