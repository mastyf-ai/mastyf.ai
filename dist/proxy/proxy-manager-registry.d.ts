import type { ProxyManager } from './proxy-manager.js';
export declare function registerProxyManager(mgr: ProxyManager): void;
export declare function getActiveProxyManager(): ProxyManager | null;
/** Total number of registered proxy servers (stdio + SSE + streamable + WS). */
export declare function getRegisteredServerCount(): number;
//# sourceMappingURL=proxy-manager-registry.d.ts.map