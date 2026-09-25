export interface ParityFixture {
    id: string;
    method?: string;
    toolName: string;
    arguments?: Record<string, unknown>;
}
export interface TargetRunResult {
    status: number;
    blocked: boolean;
    body: unknown;
}
export interface ParityMismatch {
    id: string;
    toolName: string;
    legacyBlocked: boolean;
    dataPlaneBlocked: boolean;
    legacyStatus: number;
    dataPlaneStatus: number;
}
export interface ParitySummary {
    fixtures: number;
    compared: number;
    mismatches: number;
    legacyProxy: string;
    dataPlane: string;
}
export declare function validateFixtureCount(fixtures: unknown[]): void;
export declare function extractBlocked(responseBody: unknown, statusCode: number): boolean;
export declare function compareParity(fixtures: ParityFixture[], legacyRunner: (fx: ParityFixture) => Promise<TargetRunResult>, dataPlaneRunner: (fx: ParityFixture) => Promise<TargetRunResult>, legacyProxy: string, dataPlane: string): Promise<{
    summary: ParitySummary;
    mismatches: ParityMismatch[];
}>;
//# sourceMappingURL=parity-harness.d.ts.map