'use client';

import { useParams } from 'next/navigation';
import PromptEditor from '@/features/editor/PromptEditor';

export default function EditPromptPage() {
  const params = useParams<{ id: string }>();
  // Keyed by id so moving between prompts starts from a clean editor.
  return <PromptEditor key={params.id} promptId={Number(params.id)} />;
}
