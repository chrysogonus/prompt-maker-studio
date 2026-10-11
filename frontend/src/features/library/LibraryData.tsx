'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiClient } from '@/lib/api';
import { LIBRARY_CHANGED_EVENT } from '@/lib/libraryEvents';
import type { PromptHistoryResponse } from '@/types/prompt';

interface LibraryData {
  prompts: PromptHistoryResponse[] | null;
  load: () => Promise<PromptHistoryResponse[]>;
  refresh: () => Promise<PromptHistoryResponse[]>;
}

const LibraryContext = createContext<LibraryData | null>(null);

/** Mounted inside the authenticated shell and keyed by account, never global. */
export function LibraryDataProvider({ children }: { children: ReactNode }) {
  const [prompts, setPrompts] = useState<PromptHistoryResponse[] | null>(null);
  const pending = useRef<Promise<PromptHistoryResponse[]> | null>(null);
  const mounted = useRef(true);
  const invalidated = useRef(false);

  const load = useCallback(() => {
    if (!pending.current) {
      const readLatest = async () => {
        for (;;) {
          invalidated.current = false;
          let data: PromptHistoryResponse[];
          try {
            data = await ApiClient.getSavedPrompts();
          } catch (error) {
            if (!invalidated.current || !mounted.current) throw error;
            continue;
          }
          // All waiting consumers receive a read made after the latest write.
          if (invalidated.current && mounted.current) continue;
          if (mounted.current) setPrompts(data);
          return data;
        }
      };
      pending.current = readLatest().finally(() => { pending.current = null; });
    }
    return pending.current;
  }, []);

  const refresh = useCallback(() => {
    if (!pending.current) return load();
    invalidated.current = true;
    return pending.current;
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    const invalidate = () => { void refresh().catch(() => {}); };
    window.addEventListener(LIBRARY_CHANGED_EVENT, invalidate);
    return () => {
      mounted.current = false;
      window.removeEventListener(LIBRARY_CHANGED_EVENT, invalidate);
    };
  }, [refresh]);

  const value = useMemo(() => ({ prompts, load, refresh }), [prompts, load, refresh]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibraryData(): LibraryData {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('Library data requires the authenticated library provider.');
  return value;
}
