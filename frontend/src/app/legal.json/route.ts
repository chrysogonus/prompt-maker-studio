import { availableLegalPages } from '@/lib/legal';

// Server pages pass the list to their footer directly. Client screens (sign-in,
// the app shell) cannot read the folder, so they ask here instead.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ pages: await availableLegalPages() });
}
