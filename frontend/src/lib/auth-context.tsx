'use client';

import { createContext, useContext } from 'react';

interface AuthContextValue {
  currentUser: string | null;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Must be used within `(app)/layout.tsx`'s authenticated tree. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within the authenticated app layout');
  }
  return ctx;
}
