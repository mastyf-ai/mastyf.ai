// The free service has no spend caps.
export async function tryReserveSpend(): Promise<{ ok: true }> { return { ok: true }; }
export async function releaseReservedSpend(): Promise<void> {}
export async function commitSpend(): Promise<void> {}
export async function recordActualSpend(): Promise<void> {}
export function resetUnifiedSpendPoolForTests(): void {}
export async function getSpendCapsStatus(): Promise<Record<string, unknown>> { return {}; }

/** Marks this as the free service's stand-in (checked by the tests). */
export const __mastyfCheckStub = true;
