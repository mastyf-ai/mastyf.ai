export function adjustSandboxTierForZeroTrust(enforcer: { getTier(scope: unknown): unknown }, params: { serverName: string }) {
  const previousTier = enforcer.getTier({ scopeType: 'server', scopeId: params.serverName });
  return { previousTier, newTier: previousTier, adjusted: false };
}

/** Marks this as the free service's stand-in (checked by the tests). */
export const __mastyfCheckStub = true;
