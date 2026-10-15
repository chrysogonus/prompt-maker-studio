'use client';

import { createContext, useContext } from 'react';

interface AuthContextValue {
  currentUser: string | null;
  logout: () => void;
  /** Reflect a rename; the session follows the immutable account ID, not the name. */
  setCurrentUser: (username: string) => void;
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
