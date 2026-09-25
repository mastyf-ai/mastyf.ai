export declare function clearLocalRugPullAlertsForTests(): void;
/** Ops: clear in-process rug-pull flags on proxy start when env set. */
export declare function maybeClearRugPullOnStart(): void;
export declare function publishRugPullAlert(serverName: string, tenantId: string, fingerprint: string): Promise<void>;
export declare function isClusterRugPullActive(serverName: string, tenantId: string): Promise<boolean>;
/** Ops: clear rug-pull flag for a server/tenant (local + Redis). */
export declare function clearRugPullAlert(serverName: string, tenantId: string): Promise<void>;
//# sourceMappingURL=rug-pull-cluster.d.ts.map