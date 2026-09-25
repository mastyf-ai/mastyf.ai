export type TribunalTimeoutAction = 'block' | 'allow' | 'escalate-to-oncall';
export declare function getTribunalTimeoutMs(): number;
export declare function getTribunalTimeoutAction(): TribunalTimeoutAction;
export declare function countPendingTribunalRecords(): Promise<number>;
export declare function sweepTribunalTimeouts(): Promise<{
    processed: number;
    action: TribunalTimeoutAction;
}>;
export declare function startTribunalSlaSweep(intervalMs?: number): void;
export declare function stopTribunalSlaSweep(): void;
//# sourceMappingURL=tribunal-sla.d.ts.map