/**
 * Shared scoring utility used by both index.ts (MCP server) and cli.ts (CLI).
 *
 * v2.3.4: Now includes cost efficiency as a third scoring dimension.
 * Final score = weighted average of security (40%), health (30%), cost efficiency (30%).
 * Cost efficiency = how well your setup uses cheaper models / avoids expensive ones.
 *
 * When priced cost data is not available, only security and health are scored.
 */

function getCostEfficiency(costs: { estimatedCostUSD: number; pricingModel: string; priced?: boolean; listInputPerM?: number }[]): number | null {
  const pricedCosts = costs.filter((c) => c.priced !== false && Number.isFinite(c.listInputPerM));
  if (pricedCosts.length === 0) return null;

  const avgModelCost = pricedCosts.reduce((sum, c) => sum + Number(c.listInputPerM), 0) / pricedCosts.length;

  // Score: 100 for free/cheapest ($0-$0.30/M), 50 for mid-tier ($2-$5/M), 0 for expensive ($50+/M)
  if (avgModelCost <= 0.30) return 100;
  if (avgModelCost <= 1.0) return 90;
  if (avgModelCost <= 3.0) return 70;
  if (avgModelCost <= 5.0) return 50;
  if (avgModelCost <= 15.0) return 30;
  if (avgModelCost <= 40.0) return 15;
  return 5;
}

export function calculateOverallScore(
  security: { score: number }[],
  health: { successRate: number }[],
  costs?: { estimatedCostUSD: number; pricingModel: string; priced?: boolean; listInputPerM?: number }[]
): number {
  if (security.length === 0 && health.length === 0) return 0;

  const secAvg = security.length > 0
    ? security.reduce((sum, s) => sum + s.score, 0) / security.length
    : 0;
  const healthAvg = health.length > 0
    ? health.reduce((sum, h) => sum + h.successRate * 100, 0) / health.length
    : 0;

  // If priced cost data is available, use weighted 3-way scoring
  if (costs && costs.length > 0) {
    const costEff = getCostEfficiency(costs);
    if (costEff === null) {
      if (security.length === 0) return Math.round(healthAvg);
      if (health.length === 0) return Math.round(secAvg);
      return Math.round((secAvg + healthAvg) / 2);
    }
    if (security.length === 0 && health.length === 0) return Math.round(costEff);
    if (security.length === 0) return Math.round((healthAvg * 0.5) + (costEff * 0.5));
    if (health.length === 0) return Math.round((secAvg * 0.6) + (costEff * 0.4));
    return Math.round((secAvg * 0.40) + (healthAvg * 0.30) + (costEff * 0.30));
  }

  // Score security + health only when cost data is unavailable.
  if (security.length === 0) return Math.round(healthAvg);
  if (health.length === 0) return Math.round(secAvg);
  return Math.round((secAvg + healthAvg) / 2);
}