import PublicShell from '@/components/public/PublicShell';
import { availableLegalPages } from '@/lib/legal';

// Metadata must use FRONTEND_URL at request time, including on published images.
// Templates stay public even when the visitor has an app session.
export const dynamic = 'force-dynamic';

export default async function GalleryLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell contentId="gallery-content" homeLabel="All templates" homeHref="/gallery" legalPages={await availableLegalPages()}>{children}</PublicShell>;
}
