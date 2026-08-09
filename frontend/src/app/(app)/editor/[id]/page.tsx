'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import EditorDetail from '@/components/EditorDetail';

export default function EditPromptPage() {
  const params = useParams<{ id: string }>();
  const promptId = Number(params.id);

  return (
    <Suspense>
      <EditorDetail promptId={promptId} />
    </Suspense>
  );
}
