import PublicShell from '@/components/public/PublicShell';
import { availableLegalPages } from '@/lib/legal';

// Metadata must use FRONTEND_URL at request time, including on published images.
// Guides stay public even when the reader has an app session.
export const dynamic = 'force-dynamic';

export default async function GuidesLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell contentId="guide-content" homeLabel="All guides" homeHref="/guides" legalPages={await availableLegalPages()}>{children}</PublicShell>;
}
