import PublicShell from '@/components/public/PublicShell';

// Metadata must use FRONTEND_URL at request time, including on published images.
// Templates stay public even when the visitor has an app session.
export const dynamic = 'force-dynamic';

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell contentId="gallery-content" homeLabel="All templates" homeHref="/gallery">{children}</PublicShell>;
}
