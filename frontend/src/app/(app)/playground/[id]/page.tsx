import { redirect } from 'next/navigation';

// The Playground was retired; old links open the prompt in the editor instead.
export default async function PlaygroundRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/editor/${encodeURIComponent(id)}`);
}
