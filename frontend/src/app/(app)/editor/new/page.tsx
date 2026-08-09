'use client';

import { useEffect } from 'react';
import EditorWorkspace from '@/components/EditorWorkspace';
import { useAuth } from '@/lib/auth-context';
import { pageTitle } from '@/lib/branding';

export default function NewPromptPage() {
  const { currentUser } = useAuth();
  useEffect(() => {
    document.title = pageTitle('New prompt');
    return () => {
      document.title = pageTitle();
    };
  }, []);
  return <EditorWorkspace currentUser={currentUser} />;
}
