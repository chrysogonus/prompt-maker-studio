import { guideMetadata } from './guides';

interface ToolSummary {
  path: string;
  title: string;
  description: string;
}

export const TOOLS_INDEX: ToolSummary = {
  path: '/tools',
  title: 'Free prompt tools',
  description: 'Free tools for writing better AI prompts: fill in prompt templates, compare two prompts, check a prompt for missing parts and estimate its tokens and cost. No account needed.',
};

export const TOOLS = {
  filler: {
    path: '/tools/prompt-template-filler',
    title: 'Prompt template filler',
    description: 'Paste a prompt with {{variables}}, fill in a field for each one and copy the finished prompt. Runs in your browser; nothing is uploaded.',
  },
  linter: {
    path: '/tools/prompt-linter',
    title: 'Prompt checker',
    description: 'Check a prompt for a missing role, output format, length or example, and for broken tags and variables. Runs in your browser; nothing is uploaded.',
  },
  refiner: {
    path: '/tools/prompt-refiner',
    title: 'Free AI prompt refiner',
    description: 'Paste a prompt and get a clearer, more specific version, with optional questions about what you need. Free to try without an account, within daily limits, where this site offers it.',
  },
  diff: {
    path: '/tools/prompt-diff',
    title: 'Prompt diff',
    description: 'Compare two versions of a prompt word by word to see exactly what changed. Runs in your browser; nothing is uploaded.',
  },
  tokens: {
    path: '/tools/token-counter',
    title: 'Prompt token counter',
    description: 'Estimate how many tokens a prompt uses and what it costs across current OpenAI, Anthropic and Gemini models. Runs in your browser; nothing is uploaded.',
  },
} satisfies Record<string, ToolSummary>;

export type Tool = (typeof TOOLS)[keyof typeof TOOLS];

// The guides' builder takes any public page summary.
export const toolMetadata = guideMetadata;
