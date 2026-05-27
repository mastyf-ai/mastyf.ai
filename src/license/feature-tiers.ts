/**
 * Open-core feature tiers — Community (free on npm) vs Pro (paid license).
 */

import { Logger } from '../utils/logger.js';
import { resolveProCheckoutUrl } from './pro-checkout-url.js';

export const PRO_FEATURES = [
  'dashboard',
  'websocket',
  'swarm',
  'ai',
  'audit',
  'metrics',
  'cost',
  'health',
  'fleet',
  'admin',
  'multi_tenant',
  'semantic_async',
  'policy', // cloud policy sync via control plane
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

const PRO_FEATURE_SET = new Set<string>(PRO_FEATURES);

/** Community tier — always available without a license. */
export const COMMUNITY_FEATURES = ['proxy', 'cli', 'policy_local'] as const;

let warnedOpenCoreFalse = false;

/** v3+: Pro gates always apply. GUARDIAN_OPEN_CORE=false is ignored (use a valid GUARDIAN_LICENSE_KEY for local development). */
export function isOpenCoreEnabled(): boolean {
  if (process.env['GUARDIAN_OPEN_CORE'] === 'false') {
    if (!warnedOpenCoreFalse) {
      warnedOpenCoreFalse = true;
      Logger.warn(
        '[license] GUARDIAN_OPEN_CORE=false is deprecated in v3.0 — Pro gates remain active. ' +
          'For local development, set GUARDIAN_LICENSE_KEY and GUARDIAN_CONTROL_PLANE_URL (see docs/PRO_SETUP.md)',
      );
    }
  }
  return true;
}

/** Test/CI license bypass — disabled in enterprise mode. */
export function isCiLicenseBypass(): boolean {
  if (process.env['GUARDIAN_ENTERPRISE_MODE'] === 'true') {
    return false;
  }
  if (process.env['GUARDIAN_CI_BYPASS_LICENSE'] === 'true') {
    return true;
  }
  return false;
}

/** Warn/fail startup when enterprise mode has license bypass env set. */
export function assertEnterpriseLicensePosture(): void {
  if (process.env['GUARDIAN_ENTERPRISE_MODE'] !== 'true') return;
  if (process.env['GUARDIAN_CI_BYPASS_LICENSE'] === 'true') {
    throw new Error(
      'GUARDIAN_CI_BYPASS_LICENSE is not allowed when GUARDIAN_ENTERPRISE_MODE=true',
    );
  }
  if (process.env['GUARDIAN_DEV_UNLOCK_ALL'] === 'true') {
    throw new Error(
      'GUARDIAN_DEV_UNLOCK_ALL is not allowed when GUARDIAN_ENTERPRISE_MODE=true',
    );
  }
}

/** isDevUnlockAllowed removed in v3.2.3 — use a valid GUARDIAN_LICENSE_KEY for local development. */
export const isDevUnlockAllowed = () => false;

export function isProFeature(feature: string): boolean {
  return PRO_FEATURE_SET.has(feature);
}

export function allProFeatureNames(): ProFeature[] {
  return [...PRO_FEATURES];
}

export function getProCheckoutUrl(): string {
  return resolveProCheckoutUrl();
}

export function licenseTier(licensed: boolean): 'community' | 'pro' {
  return licensed ? 'pro' : 'community';
}
