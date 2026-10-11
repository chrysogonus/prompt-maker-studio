import { redirect } from 'next/navigation';

// The library is the home page.
export default function HomePage() {
  redirect('/library');
}
