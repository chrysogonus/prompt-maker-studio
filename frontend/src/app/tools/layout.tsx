import PublicShell from '@/components/public/PublicShell';

// Metadata must use FRONTEND_URL at request time, including on published images.
// Tools stay public even when the visitor has an app session.
export const dynamic = 'force-dynamic';

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell contentId="tool-content" homeLabel="All tools" homeHref="/tools">{children}</PublicShell>;
}
