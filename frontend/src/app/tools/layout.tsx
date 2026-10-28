import PublicShell from '@/components/public/PublicShell';
import { availableLegalPages } from '@/lib/legal';

// Metadata must use FRONTEND_URL at request time, including on published images.
// Tools stay public even when the visitor has an app session.
export const dynamic = 'force-dynamic';

export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell contentId="tool-content" homeLabel="All tools" homeHref="/tools" legalPages={await availableLegalPages()}>{children}</PublicShell>;
}
