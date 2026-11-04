const PAID_TIERS = new Set(['pro', 'team', 'enterprise']);

export function isPaidTier(tier: string): boolean {
  return PAID_TIERS.has(tier);
}
