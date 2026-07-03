import { auth } from './auth';

/** Returns session or null when auth is misconfigured (missing AUTH_SECRET, etc.). */
export async function safeAuth() {
  if (!process.env.AUTH_SECRET) return null;
  try {
    return await auth();
  } catch {
    return null;
  }
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET);
}
