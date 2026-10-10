'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PromptEditor from '@/components/editor/PromptEditor';

function NewPrompt() {
  const params = useSearchParams();
  // The empty library links here to start from a template or straight into Import text.
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
