import { isPaidTier } from '@/lib/billing/paid-tier';
import { workspaceTier } from '@/lib/billing/workspace-tier';

/** Protocol X is part of the paid plans. A database failure throws, so the caller answers with an error and not a verdict. */
export async function workspaceHasProtocolX(orgId: string): Promise<boolean> {
  return isPaidTier(await workspaceTier(orgId));
}
