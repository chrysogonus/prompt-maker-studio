import { guideMetadata } from './guides';

interface ToolSummary {
  path: string;
  title: string;
  description: string;
  /** ISO date of the page's last content change, for the sitemap; bump it when that changes. */
  updated?: string;
}

export const TOOLS_INDEX: ToolSummary = {
  path: '/tools',
  title: 'Free prompt tools',
  description: 'Free tools for better AI prompts: fill in templates, check a prompt for gaps, refine it, compare versions and estimate tokens and cost. No account needed.',
};

export const TOOLS = {
  filler: {
    path: '/tools/prompt-template-filler',
    title: 'Prompt template filler',
    description: 'Paste a prompt with {{variables}}, fill in a field for each one and copy the finished prompt. Runs in your browser; nothing is uploaded.',
    updated: '2026-10-23',
  },
  linter: {
    path: '/tools/prompt-linter',
    title: 'Prompt checker',
    description: 'Check a prompt for a missing role, output format, length or example, and for broken tags and variables. Runs in your browser; nothing is uploaded.',
    updated: '2026-10-22',
  },
  refiner: {
    path: '/tools/prompt-refiner',
    title: 'Prompt refiner',
    description: 'Paste a prompt and get a clearer, more specific version, with optional questions about what you need. Free to try without an account, within daily limits.',
    updated: '2026-10-27',
  },
  diff: {
    path: '/tools/prompt-diff',
    title: 'Prompt diff',
    description: 'Compare two versions of a prompt word by word to see exactly what changed. Runs in your browser; nothing is uploaded.',
    updated: '2026-10-23',
  },
  tokens: {
    path: '/tools/token-counter',
    title: 'Prompt token counter',
    description: 'Estimate how many tokens a prompt uses and what it costs across current OpenAI, Anthropic and Gemini models. Runs in your browser; nothing is uploaded.',
    updated: '2026-10-28',
  },
} satisfies Record<string, ToolSummary>;

export type Tool = (typeof TOOLS)[keyof typeof TOOLS];

// The guides' builder takes any public page summary; tool pages lead with "Free" in search results.
export function toolMetadata(tool: ToolSummary) {
  return guideMetadata(tool === TOOLS_INDEX ? tool : { ...tool, title: `Free ${tool.title.toLowerCase()}` });
}
