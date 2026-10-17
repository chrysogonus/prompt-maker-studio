import type { PromptsConfigResponse } from '@/types/prompt';

export function budgetStatusText(scope: 'shared' | 'user' | null | undefined, resetsAt?: string | null, estimated = false) {
  const message = estimated
    ? `The estimated request cost exceeds ${scope === 'user' ? 'your' : 'the shared'} remaining monthly API budget.`
    : `${scope === 'user' ? 'Your' : 'The shared'} monthly API budget has been reached.`;
  return message + (resetsAt ? ` Resets ${new Date(resetsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.` : ' Resets at the start of next month (UTC).');
}

export default function AICallContext({ config }: { config: PromptsConfigResponse | null }) {
  return <p>
    {config?.provider_connected
      ? `Uses ${config.provider_label ?? 'your configured provider'} / ${config.model ?? 'configured model'}. May incur provider charges.`
      : config ? 'Connect an AI provider in Settings before running this action.' : 'AI connection details are unavailable. Reload or check Settings before running this action.'}
    {config?.budget_exhausted && ` ${budgetStatusText(config.budget_scope, config.budget_resets_at)}`}
  </p>;
}
