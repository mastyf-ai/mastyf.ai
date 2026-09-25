export type ReadinessCheck = () => Promise<{
    ok: boolean;
    detail?: string;
}>;
export declare function registerReadinessCheck(check: ReadinessCheck): void;
export declare function runReadinessChecks(): Promise<{
    ready: boolean;
    checks: Record<string, string>;
}>;
//# sourceMappingURL=readiness.d.ts.map