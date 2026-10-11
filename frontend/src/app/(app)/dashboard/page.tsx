import { redirect } from 'next/navigation';

// Kept so old bookmarks to the retired dashboard still land somewhere useful.
export default function DashboardRedirect() {
  redirect('/library');
}
