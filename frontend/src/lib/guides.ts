import type { Metadata } from 'next';
import { APP_NAME, siteUrl } from './branding';

interface GuideSummary {
  path: string;
  title: string;
  description: string;
}

export const GUIDES_INDEX: GuideSummary = {
  path: '/guides',
  title: 'Practical guides for reusable AI prompts',
  description: 'Learn what makes a good AI prompt, how to write prompts for coding agents, images, research and writing, and how to keep a reusable prompt library.',
};

export const GUIDES = {
  reusable: {
    path: '/guides/reusable-ai-prompts',
    title: 'How to create reusable AI prompts',
    description: 'Turn a prompt you keep retyping into named sections, save it in your library, and keep improving it without losing earlier versions.',
  },
  variables: {
    path: '/guides/prompt-template-variables',
    title: 'How to use variables in AI prompt templates',
    description: 'Build a weekly update template with {{variables}}, add hints and example inputs, and copy a filled prompt into your preferred AI assistant.',
  },
  organize: {
    path: '/guides/organize-chatgpt-prompts',
    title: 'How to organize and reuse your ChatGPT prompts',
    description: 'Keep useful ChatGPT prompts in a personal library with clear names, folders, favorites, search, and version history.',
  },
  goodPrompt: {
    path: '/guides/what-makes-a-good-prompt',
    title: 'What makes a good AI prompt',
    description: 'The six parts most prompts need, role, context, task, format, constraints and examples, with a complete example and how to test and improve a prompt.',
  },
  codingAgents: {
    path: '/guides/prompts-for-coding-agents',
    title: 'How to write prompts for coding agents',
    description: 'Brief Claude Code, Codex or Cursor like a work ticket: the goal, where to look, constraints, a checkable definition of done and what to report.',
  },
  imagePrompts: {
    path: '/guides/image-generation-prompts',
    title: 'How to write image generation prompts',
    description: 'Describe subject, setting, composition, style, lighting and format so DALL·E, Midjourney, Stable Diffusion or Gemini produce the picture you have in mind.',
  },
  researchWriting: {
    path: '/guides/research-and-writing-prompts',
    title: 'Prompts for research and writing',
    description: 'Get summaries and drafts that stay close to your sources: citations, audience, tone, structure and what the model should do when information is missing.',
  },
} satisfies Record<string, GuideSummary>;

// Called by dynamic pages so a published image uses its deployment's origin.
export function guideMetadata(guide: GuideSummary): Metadata {
  const url = `${siteUrl()}${guide.path}`;
  const title = `${guide.title} · ${APP_NAME}`;
  const image = `${siteUrl()}/landing/editor.png`;
  return {
    title,
    description: guide.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website', url, siteName: APP_NAME, title,
      description: guide.description,
      images: [{ url: image, width: 1440, height: 900 }],
    },
    twitter: { card: 'summary_large_image', title, description: guide.description, images: [image] },
  };
}
