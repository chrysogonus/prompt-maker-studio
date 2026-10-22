import PublicShell from '@/components/public/PublicShell';

// Metadata must use FRONTEND_URL at request time, including on published images.
// Guides stay public even when the reader has an app session.
export const dynamic = 'force-dynamic';

export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell contentId="guide-content" homeLabel="All guides" homeHref="/guides">{children}</PublicShell>;
}
