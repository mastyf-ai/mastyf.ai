import type { LicenseTier } from '@/lib/dashboard-data';

/** License tiers (licenses.tier) and the pricing plan each corresponds to (PRICING_TIERS ids). */
export const PLAN_FOR_TIER: Record<LicenseTier, { name: string; pricingId: string }> = {
  free: { name: 'Community', pricingId: 'community' },
  pro: { name: 'Developer Pro', pricingId: 'developer' },
  team: { name: 'Team', pricingId: 'team' },
  enterprise: { name: 'Custom', pricingId: 'custom' },
};
