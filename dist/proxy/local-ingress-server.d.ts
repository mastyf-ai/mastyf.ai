import type { ProxyManager } from './proxy-manager.js';
export interface LocalIngressOptions {
    listenPort: number;
    serverName: string;
    proxyManager: ProxyManager;
}
export declare class LocalIngressServer {
    private opts;
    private httpServer;
    private boundPort;
    constructor(opts: LocalIngressOptions);
    getListenPort(): number;
    start(): Promise<number>;
    stop(): Promise<void>;
}
//# sourceMappingURL=local-ingress-server.d.ts.map