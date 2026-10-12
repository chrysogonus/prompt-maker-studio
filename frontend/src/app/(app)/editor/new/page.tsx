'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PromptEditor from '@/features/editor/PromptEditor';

function NewPrompt() {
  const params = useSearchParams();
  // The empty library links here to start from a template or straight into Paste a prompt.
  return (
    <PromptEditor
      initialStarter={params.get('starter') ?? undefined}
      openImport={params.get('import') === '1'}
    />
  );
}

export default function NewPromptPage() {
  return (
    <Suspense>
      <NewPrompt />
    </Suspense>
  );
}
