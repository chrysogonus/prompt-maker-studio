import { expect, it } from 'vitest';
import { judgeAgreement, resultFailure, resultStatus, runStatus } from '@/lib/evaluationStatus';
import type { EvalResult, EvalRun } from '@/types/evaluation';

const result: EvalResult = { id: 1, eval_case_id: 1, method: 'rule', label: '', rationale: null,
  output_text: 'ok', score: null, human_score: null, is_pending: false, criteria: null, variables: {}, judge_model: null };
const run = (results: EvalResult[], score: number | null = null) => ({ results, score }) as EvalRun;
it('distinguishes generation and scoring errors from legitimate unscored rules', () => {
  expect(resultFailure({ ...result, output_text: null })).toBe('generation');
  expect(resultFailure({ ...result, method: 'judge' })).toBe('scoring');
  expect(resultStatus(result)).toBe('Unscored');
  expect(resultStatus({ ...result, output_text: '', method: 'manual', is_pending: true })).toBe('Awaiting your rating');
});
it('keeps mixed failures visible alongside pending ratings and scores', () => {
  const failed = { ...result, output_text: null };
  expect(runStatus(run([failed]))).toBe('Failed');
  expect(runStatus(run([failed, { ...result, is_pending: true }]))).toBe('Partially failed');
  expect(runStatus(run([failed, { ...result, score: 0 }], 0))).toBe('Partially failed');
  expect(runStatus(run([{ ...result, is_pending: true }]))).toBe('Awaiting your rating');
  expect(runStatus(run([result]))).toBe('Unscored');
  expect(runStatus(run([{ ...result, score: 0 }], 0))).toBe('Scored');
});
it('counts AI reviews within one star of the person\'s rating as agreement', () => {
  const judge = { ...result, method: 'judge' as const, score: 70 };
  expect(judgeAgreement([run([
    { ...judge, human_score: 80 }, { ...judge, human_score: 40 }, judge, { ...judge, score: null, human_score: 60 },
    { ...result, score: 80, human_score: 80 },
  ])])).toEqual({ rated: 2, agreed: 1 });
});
