'use client';

import { useParams } from 'next/navigation';
import EvaluationPage from '@/features/evaluation/EvaluationPage';

export default function EvaluatePromptPage() {
  const params = useParams<{ id: string }>();
  return <EvaluationPage key={params.id} promptId={Number(params.id)} />;
}
