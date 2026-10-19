import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AICallContext from '@/components/ui/AICallContext';
import type { PromptsConfigResponse } from '@/types/prompt';

const config: PromptsConfigResponse = {
  provider_connected: true,
  provider: 'openai',
  provider_label: 'OpenAI',
  model: 'gpt-6-luna',
  available_models: [],
  budget_exhausted: false,
  global_budget_remaining_usd: null,
};

describe('AICallContext', () => {
  it('says the user pays on their own connection', () => {
    render(<AICallContext config={config} />);
    expect(screen.getByText(/Uses your connection \(OpenAI \/ gpt-6-luna\)\. Your provider may charge/)).toBeInTheDocument();
  });

  it('says the operator pays on the shared server default', () => {
    render(<AICallContext config={{ ...config, uses_server_default: true }} />);
    expect(screen.getByText(/shared connection \(OpenAI \/ gpt-6-luna\), paid for by the site operator/)).toBeInTheDocument();
  });
});
