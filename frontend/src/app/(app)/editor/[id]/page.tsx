'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import PromptEditor from '@/features/editor/PromptEditor';

function EditorContent() {
  const params = useParams<{ id: string }>();
  const initialMode = useSearchParams().get('mode') === 'filled' ? 'filled' : undefined;
  return <PromptEditor key={`${params.id}:${initialMode ?? ''}`} promptId={Number(params.id)} initialMode={initialMode} />;
}

export default function EditPromptPage() {
  return <Suspense fallback={<p>Loading prompt…</p>}><EditorContent /></Suspense>;
}
