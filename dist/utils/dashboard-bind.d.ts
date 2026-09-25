/**
 * Dashboard bind + auth posture. Auth is on by default, including loopback.
 * Auth-off is explicit only, and is refused on any non-loopback bind.
 */
export declare function resolveDashboardBindHost(bind?: string | undefined): string;
export declare function isLoopbackDashboardBind(host: string): boolean;
export declare function defaultDashboardAuthDisabled(_bindHost?: string): 'true' | 'false';
/** True when we must refuse listen (auth-off on a non-loopback bind). */
export declare function shouldRefuseUnauthenticatedDashboardBind(bindHost: string, authDisabled: boolean): boolean;
//# sourceMappingURL=dashboard-bind.d.ts.map