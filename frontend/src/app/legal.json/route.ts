import { availableLegalPages } from '@/lib/legal';

// Every other page is prerendered, so the footer cannot know at build time
// whether this deployment has legal pages. It asks here instead.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ pages: await availableLegalPages() });
}
