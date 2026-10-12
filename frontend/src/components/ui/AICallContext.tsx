import type { PromptsConfigResponse } from '@/types/prompt';

export default function AICallContext({ config }: { config: PromptsConfigResponse | null }) {
  return <p>
    {config?.provider_connected
      ? `Uses ${config.provider_label ?? 'your configured provider'} / ${config.model ?? 'configured model'}. May incur provider charges.`
      : config ? 'Connect an AI provider in Settings before running this action.' : 'AI connection details are unavailable. Reload or check Settings before running this action.'}
    {config?.budget_exhausted && ' The shared monthly API budget has been reached.'}
  </p>;
}
