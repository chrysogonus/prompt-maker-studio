import type { Metadata } from 'next';
import { APP_NAME, siteUrl } from './branding';

interface GuideSummary {
  path: string;
  title: string;
  description: string;
  /** ISO dates for articles; bump `updated` when a guide's content changes. */
  published?: string;
  updated?: string;
}

export const GUIDES_INDEX: GuideSummary = {
  path: '/guides',
  title: 'Practical guides for reusable AI prompts',
  description: 'Learn what makes a good AI prompt, how to write prompts for coding agents, images, research and writing, and how to keep a reusable prompt library.',
};

export const GUIDES = {
  library: {
    path: '/guides/what-is-a-prompt-library',
    title: 'What is a prompt library?',
    description: 'A prompt library keeps the AI prompts you reuse in one place, named and ready to fill in. What belongs in one, what makes an entry useful, and how to start.',
    published: '2026-10-27',
    updated: '2026-10-27',
  },
  reusable: {
    path: '/guides/reusable-ai-prompts',
    title: 'How to create reusable AI prompts',
    description: 'Turn a prompt you keep retyping into named sections, save it in your library, and keep improving it without losing earlier versions.',
    published: '2026-10-15',
    updated: '2026-10-26',
  },
  variables: {
    path: '/guides/prompt-template-variables',
    title: 'How to use variables in AI prompt templates',
    description: 'Build a weekly update template with {{variables}}, add hints and example inputs, and copy a filled prompt into your preferred AI assistant.',
    published: '2026-10-15',
    updated: '2026-10-28',
  },
  organize: {
    path: '/guides/organize-chatgpt-prompts',
    title: 'How to organize and reuse your ChatGPT prompts',
    description: 'Keep useful ChatGPT prompts in a personal library with clear names, folders, favourites, search and version history.',
    published: '2026-10-15',
    updated: '2026-10-26',
  },
  goodPrompt: {
    path: '/guides/what-makes-a-good-prompt',
    title: 'What makes a good AI prompt',
    description: 'The six parts most prompts need (role, context, task, format, constraints and examples), with a complete example and how to test and improve a prompt.',
    published: '2026-10-22',
    updated: '2026-10-27',
  },
  codingAgents: {
    path: '/guides/prompts-for-coding-agents',
    title: 'How to write prompts for coding agents',
    description: 'Brief Claude Code, Codex or Cursor like a work ticket: the goal, where to look, constraints, a checkable definition of done and what to report.',
    published: '2026-10-22',
    updated: '2026-10-28',
  },
  imagePrompts: {
    path: '/guides/image-generation-prompts',
    title: 'How to write image generation prompts',
    description: 'Describe subject, setting, composition, style, lighting and format so GPT Image, Midjourney, Stable Diffusion or Gemini produce the picture you have in mind.',
    published: '2026-10-22',
    updated: '2026-10-28',
  },
  researchWriting: {
    path: '/guides/research-and-writing-prompts',
    title: 'Prompts for research and writing',
    description: 'Get summaries and drafts that stay close to your sources: citations, audience, tone, structure and what the model should do when information is missing.',
    published: '2026-10-22',
    updated: '2026-10-28',
  },
  connect: {
    path: '/guides/connect-chatgpt-claude',
    title: 'How to use your prompt library in ChatGPT and Claude',
    description: 'Connect ChatGPT or Claude to your prompt library to list, open, save and update prompts from a chat, on your own plan and without an API key.',
    published: '2026-10-27',
    updated: '2026-10-27',
  },
} satisfies Record<string, GuideSummary>;

// Called by dynamic pages so a published image uses its deployment's origin.
export function guideMetadata(guide: GuideSummary): Metadata {
  const url = `${siteUrl()}${guide.path}`;
  // The app name is added only where it fits the ~60 characters search results show.
  const branded = `${guide.title} · ${APP_NAME}`;
  const title = branded.length <= 60 ? branded : guide.title;
  const image = `${siteUrl()}/landing/editor.png`;
  return {
    title,
    description: guide.description,
    alternates: { canonical: url },
    openGraph: {
      ...(guide.published
        ? { type: 'article', publishedTime: guide.published, modifiedTime: guide.updated }
        : { type: 'website' }),
      url, siteName: APP_NAME, title,
      description: guide.description,
      images: [{ url: image, width: 1440, height: 900 }],
    },
    twitter: { card: 'summary_large_image', title, description: guide.description, images: [image] },
  };
}
