import type { Metadata } from 'next';
import { pageTitle } from '@/lib/branding';

export const metadata: Metadata = { title: pageTitle('Reset password') };

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
