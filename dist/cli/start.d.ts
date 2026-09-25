export interface StartOptions {
    config?: string;
    policy?: string;
    blockingMode?: string;
    buildDashboard?: boolean;
    installRoot?: string;
    searchRoots?: string[];
    ideManaged?: boolean;
    noApplyIde?: boolean;
    client?: import('../wrap/client-wrap.js').WrapClient;
}
export declare function runStart(opts?: StartOptions): Promise<void>;
//# sourceMappingURL=start.d.ts.map