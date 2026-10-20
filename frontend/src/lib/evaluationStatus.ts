import type { EvalResult, EvalRun } from '@/types/evaluation';

export function resultFailure(result: EvalResult): 'generation' | 'scoring' | null {
  if (result.output_text === null && !result.is_pending && result.score === null) return 'generation';
  if (result.method === 'judge' && !result.is_pending && result.score === null) return 'scoring';
  return null;
}

export function resultStatus(result: EvalResult): string {
  if (resultFailure(result)) return 'Failed';
  if (result.is_pending) return 'Awaiting your rating';
  return result.score === null ? 'Unscored' : 'Scored';
}

export function runStatus(run: EvalRun): string {
  const failed = run.results.filter((result) => resultFailure(result)).length;
  if (failed) return failed === run.results.length ? 'Failed' : 'Partially failed';
  if (run.results.some((result) => result.is_pending)) return 'Awaiting your rating';
  return run.score === null ? 'Unscored' : 'Scored';
}

export function runScoreLabel(run: EvalRun): string {
  const status = runStatus(run);
  return status === 'Scored' ? `Scored · ${Math.round(run.score!)}/100`
    : `${status}${run.score === null ? '' : ` · ${Math.round(run.score)}/100`}`;
}

// "Agreed" means the AI review's score is within one star (20 points) of the
// person's own rating of the same output.
export function judgeAgreement(runs: EvalRun[]): { rated: number; agreed: number } {
  const rated = runs.flatMap((run) => run.results)
    .filter((result) => result.method === 'judge' && result.score !== null && result.human_score !== null);
  return { rated: rated.length, agreed: rated.filter((result) => Math.abs(result.score! - result.human_score!) <= 20).length };
}

// A run of unsaved sections has no version until the same text is saved.
export function runVersionLabel(run: EvalRun): string {
  return run.tested_version === null ? 'Unsaved draft' : `Version ${run.tested_version}`;
}
