type ServerMap = Record<string, Record<string, unknown>>;
interface ConnectedAgent {
    id: string;
    configPath: string;
    originals: ServerMap;
    /** The first backup and the file's hash right after wrapping: if unchanged, restore is exact. */
    backupPath?: string;
    wrappedSha?: string;
}
export interface ConnectState {
    instanceId: string;
    connectedAt: string;
    key?: string;
    agents: ConnectedAgent[];
}
export interface ConnectResult {
    connected: {
        id: string;
        wrapped: string[];
    }[];
    failed: {
        id: string;
        reason: string;
    }[];
    /** Servers left direct: URL-based ones the stdio proxy can't front yet, and ones that only look wrapped. */
    notProtected: {
        id: string;
        server: string;
    }[];
}
export declare function readConnectState(home: string): ConnectState | null;
export declare function connect(opts: {
    home: string;
    projectRoot: string;
    nodeCommand: string;
    key?: string;
}): ConnectResult;
export declare function disconnect(opts: {
    home: string;
}): {
    restored: string[];
    left: string[];
    failed: string[];
};
/** The JSON to paste into an agent `connect` doesn't recognise. */
export declare function printableConfig(opts: {
    projectRoot: string;
    nodeCommand: string;
    home: string;
    server: string;
    upstream: {
        command: string;
        args?: string[];
    } | {
        url: string;
    };
}): string;
/** Tell the site this machine is connected. Best effort: setup never fails because of it. */
export declare function announce(opts: {
    key: string;
    instanceId: string;
    version: string;
    baseUrl: string;
    hostname?: string;
    fetchImpl?: typeof fetch;
}): Promise<boolean>;
export {};
//# sourceMappingURL=connect.d.ts.map