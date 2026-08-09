'use client';

import { useParams } from 'next/navigation';
import PlaygroundView from '@/components/PlaygroundView';

export default function PlaygroundPage() {
  const params = useParams<{ id: string }>();
  const promptId = Number(params.id);

  return <PlaygroundView promptId={promptId} />;
}
