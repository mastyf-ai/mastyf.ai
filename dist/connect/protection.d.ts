import { type AgentInventory } from '../auto-discovery/agent-inventory.js';
export interface ProtectionEvent {
    at: string;
    kind: 'on' | 'off' | 'protected' | 'restored' | 'failed';
    agent?: string;
    servers?: string[];
    message?: string;
}
export interface ProtectedServerView {
    name: string;
    transport: 'stdio' | 'http';
    protected: boolean;
    /** Who fronts it: this install, another Mastyf (such as the Shield app), or nobody. */
    via: 'mastyf' | 'other' | null;
}
export interface ProtectionStatus {
    enabled: boolean;
    changedAt: string | null;
    watching: boolean;
    lastScanAt: string;
    agents: Array<{
        id: string;
        name: string;
        configPath: string;
        servers: ProtectedServerView[];
    }>;
    totals: AgentInventory['totals'];
    /** Local servers that are on this machine but cannot be put behind the proxy automatically. */
    notProtected: Array<{
        id: string;
        server: string;
    }>;
    events: ProtectionEvent[];
}
export declare class ProtectionService {
    private readonly opts;
    private timer;
    private signature;
    private events;
    private notProtected;
    constructor(opts: {
        projectRoot: string;
        home?: string;
        nodeCommand?: string;
        scan?: () => AgentInventory;
    });
    private get home();
    private get file();
    private scan;
    private readChoice;
    private writeChoice;
    private log;
    /** Size and time of every agent settings file, so a poll that finds nothing new costs a few stats. */
    private currentSignature;
    private apply;
    /** One watcher step: when an agent's settings changed, protect anything new in them. */
    tick(): void;
    /** Resume watching if protection was left on. Does nothing until the user turns it on. */
    start(): void;
    stop(): void;
    enable(): ProtectionStatus;
    disable(): ProtectionStatus;
    status(): ProtectionStatus;
}
export declare function getProtectionService(projectRoot: string): ProtectionService;
//# sourceMappingURL=protection.d.ts.map