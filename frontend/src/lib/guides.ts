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
  description: 'Learn to create reusable AI prompts, fill template variables, and organize your ChatGPT prompt library with practical examples in Prompt Maker Studio.',
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
