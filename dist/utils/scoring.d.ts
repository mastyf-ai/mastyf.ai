/**
 * Shared scoring utility used by both index.ts (MCP server) and cli.ts (CLI).
 *
 * v2.3.4: Now includes cost efficiency as a third scoring dimension.
 * Final score = weighted average of security (40%), health (30%), cost efficiency (30%).
 * Cost efficiency = how well your setup uses cheaper models / avoids expensive ones.
 *
 * When priced cost data is not available, only security and health are scored.
 */
export declare function calculateOverallScore(security: {
    score: number;
}[], health: {
    successRate: number;
}[], costs?: {
    estimatedCostUSD: number;
    pricingModel: string;
    priced?: boolean;
    listInputPerM?: number;
}[]): number;
//# sourceMappingURL=scoring.d.ts.map