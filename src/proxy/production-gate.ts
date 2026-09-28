/**
 * Production startup invariants for all Mastyf proxy servers.
 *
 * Invariant 1: In production mode, reference monitor cannot start without an
 *              explicitly configured PolicyEngine or TenantPolicyRegistry.
 *
 * Invariant 2: In production mode, insecure bypass flags cannot silently
 *              weaken or disable enforcement.
 *
 * Principle: Production security cannot be disabled through configuration ambiguity.
 */

export const INSECURE_BYPASS_ENV_VARS = [
  'MASTYF_INSECURE_NO_POLICY',
  'DISABLE_SECURITY',
  'BYPASS_POLICY',
  'AUDIT_ONLY',
  'MASTYF_BYPASS_SECURITY',
] as const;

export function isProductionEnvironment(): boolean {
  return (
    process.env['NODE_ENV'] === 'production' ||
    process.env['MASTYF_MODE'] === 'production' ||
    process.env['MASTYF_ENV'] === 'production' ||
    process.env['MASTYF_SECURITY_MODE'] === 'production' ||
    process.env['MASTYF_STRICT_PRODUCTION'] === 'true'
  );
}

export function assertProductionSecurityInvariants(opts: {
  serverName: string;
  hasPolicy: boolean;
}): void {
  if (!isProductionEnvironment()) {
    return;
  }

  // 1. Mandatory policy engine
  if (!opts.hasPolicy) {
    throw new Error(
      `[PRODUCTION STARTUP FAILURE] Proxy server '${opts.serverName}' cannot start without an explicitly configured PolicyEngine or TenantPolicyRegistry. Mediation is mandatory in production mode.`,
    );
  }

  // 2. Insecure bypass flags check
  for (const flag of INSECURE_BYPASS_ENV_VARS) {
    const val = process.env[flag];
    if (val === 'true' || val === '1') {
      throw new Error(
        `[PRODUCTION STARTUP FAILURE] Insecure bypass flag detected: ${flag}=${val}. Production security cannot be disabled through configuration ambiguity.`,
      );
    }
  }
}
