import type { PromptsConfigResponse } from '@/types/prompt';

export function budgetStatusText(scope: 'shared' | 'user' | null | undefined, resetsAt?: string | null, estimated = false) {
  const message = estimated
    ? `The estimated request cost exceeds ${scope === 'user' ? 'your' : 'the shared'} remaining monthly API budget.`
    : `${scope === 'user' ? 'Your' : 'The shared'} monthly API budget has been reached.`;
  return message + (resetsAt ? ` Resets ${new Date(resetsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.` : ' Resets at the start of next month (UTC).');
}

/** Which connection an AI action uses, and who pays for it. */
export function connectionText(config: PromptsConfigResponse) {
  const target = `${config.provider_label ?? 'the configured provider'} / ${config.model ?? 'configured model'}`;
  return config.uses_server_default
    ? `Uses this server’s shared connection (${target}), paid for by the site operator. Usage limits may apply.`
    : `Uses your connection (${target}). Your provider may charge for these calls.`;
}

export default function AICallContext({ config }: { config: PromptsConfigResponse | null }) {
  return <p>
    {config?.provider_connected
      ? connectionText(config)
      : config ? 'Connect an AI provider in Settings before running this action.' : 'AI connection details are unavailable. Reload or check Settings before running this action.'}
    {config?.budget_exhausted && ` ${budgetStatusText(config.budget_scope, config.budget_resets_at)}`}
  </p>;
}
