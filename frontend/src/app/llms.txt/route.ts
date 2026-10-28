import { REPOSITORY_URL } from '@/components/RepositoryLink';
import { APP_NAME, siteUrl } from '@/lib/branding';
import { GALLERY, GALLERY_INDEX, galleryPath } from '@/lib/gallery';
import { GUIDES } from '@/lib/guides';
import { TOOLS } from '@/lib/tools';

// Read on each request: FRONTEND_URL is runtime config, not built in.
export const dynamic = 'force-dynamic';

/** A plain-text map of the public pages for AI assistants (llmstxt.org). */
export function GET() {
  const origin = siteUrl();
  const link = ({ path, title, description }: { path: string; title: string; description: string }) =>
    `- [${title}](${origin}${path}): ${description}`;
  const text = [
    `# ${APP_NAME}`,
    '',
    '> An open-source prompt library and template editor. Save AI prompts as sections with {{variables}}, '
      + 'fill them in and copy them into any assistant, or use the library from ChatGPT and Claude.',
    '',
    '## Guides',
    ...Object.values(GUIDES).map(link),
    '',
    '## Free tools',
    ...Object.values(TOOLS).map(link),
    '',
    '## Prompt templates',
    link(GALLERY_INDEX),
    ...GALLERY.map((template) => link({ path: galleryPath(template.slug), title: template.title, description: template.summary })),
    '',
    '## Optional',
    `- [About](${origin}/about): what ${APP_NAME} is and who runs this site`,
    `- [MCP server](${origin}/api/mcp): remote MCP endpoint with OAuth sign-in; see ${origin}${GUIDES.connect.path}`,
    `- [Source code](${REPOSITORY_URL}): Apache-2.0`,
    '',
  ].join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
