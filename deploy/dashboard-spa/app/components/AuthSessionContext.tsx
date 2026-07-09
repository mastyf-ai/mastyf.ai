'use client';

import { createContext, useContext } from 'react';
import type { AuthStatus } from '@/lib/mastyf-ai-api';

export type AuthSessionValue = {
  status: AuthStatus | null;
  tenant: string;
  onLogout: () => void | Promise<void>;
  onRestartSession: () => void | Promise<void>;
};

const defaultValue: AuthSessionValue = {
  status: null,
  tenant: 'default',
  onLogout: () => {},
  onRestartSession: () => {},
};

export const AuthSessionContext = createContext<AuthSessionValue>(defaultValue);

export function useAuthSession(): AuthSessionValue {
  return useContext(AuthSessionContext);
}
