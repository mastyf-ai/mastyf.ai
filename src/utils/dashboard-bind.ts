/**
 * Dashboard bind + auth posture. Auth is on by default, including loopback.
 * Auth-off is explicit only, and is refused on any non-loopback bind.
 */

export function resolveDashboardBindHost(
  bind = process.env.DASHBOARD_BIND || process.env.MASTYF_AI_DASHBOARD_BIND,
): string {
  const host = (bind || '127.0.0.1').trim();
  return host || '127.0.0.1';
}

export function isLoopbackDashboardBind(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

export function defaultDashboardAuthDisabled(_bindHost?: string): 'true' | 'false' {
  return 'false';
}

/** True when we must refuse listen (auth-off on a non-loopback bind). */
export function shouldRefuseUnauthenticatedDashboardBind(
  bindHost: string,
  authDisabled: boolean,
): boolean {
  return authDisabled && !isLoopbackDashboardBind(bindHost);
}
