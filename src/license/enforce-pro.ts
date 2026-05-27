/**
 * Central Pro license enforcement for CLI and scripts.
 */
import {
  assertEnterpriseLicensePosture,
  getProCheckoutUrl,
  isCiLicenseBypass,
  isProFeature,
  type ProFeature,
} from './feature-tiers.js';
import { getLicenseClient, loadLicenseClientConfig } from './license-client.js';
import { isCiTokenCached, verifyCiToken } from './ci-token.js';

export function formatProRequiredMessage(feature: string): string {
  const checkout = getProCheckoutUrl();
  const controlPlane =
    process.env['GUARDIAN_CONTROL_PLANE_URL'] ?? 'https://mcp-guardian-cloud.vercel.app';
  return [
    `MCP Guardian Pro required for feature: ${feature}`,
    '',
    'Set on the host where you run this command:',
    '  GUARDIAN_LICENSE_KEY=<your-key-from-purchase-email>',
    `  GUARDIAN_CONTROL_PLANE_URL=${controlPlane.replace(/\/$/, '')}`,
    '',
    checkout ? `Purchase: ${checkout}` : '',
    'Setup: https://github.com/rudraneel93/mcp-guardian/blob/master/docs/PRO_SETUP.md',
    'License terms: https://github.com/rudraneel93/mcp-guardian/blob/master/docs/PRO_LICENSE.md',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function ensureProFeature(feature: ProFeature | string): Promise<void> {
  assertEnterpriseLicensePosture();
  if (isCiLicenseBypass() || isCiTokenCached()) return;

  const name = String(feature);
  if (!isProFeature(name)) return;

  const client = getLicenseClient();
  await client.start();

  if (client.hasFeature(name)) return;

  throw new ProLicenseRequiredError(name);
}

export async function exitUnlessProFeature(feature: ProFeature | string): Promise<void> {
  try {
    await ensureProFeature(feature);
  } catch (err) {
    if (err instanceof ProLicenseRequiredError) {
      console.error(formatProRequiredMessage(err.feature));
      process.exit(1);
    }
    throw err;
  }
}

/** Sync check after license client has been started (e.g. dashboard already refreshed). */
export function assertProFeatureStarted(feature: ProFeature | string): void {
  assertEnterpriseLicensePosture();
  if (isCiLicenseBypass() || isCiTokenCached()) return;
  const name = String(feature);
  if (!isProFeature(name)) return;
  if (!getLicenseClient().hasFeature(name)) {
    throw new ProLicenseRequiredError(name);
  }
}

export class ProLicenseRequiredError extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super(`Pro license required: ${feature}`);
    this.name = 'ProLicenseRequiredError';
    this.feature = feature;
  }
}

/** CLI entry: node dist/license/check-pro.js <feature> */
export async function runCheckProCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const feature = argv[0] || 'swarm';
  try {
    assertEnterpriseLicensePosture();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (isCiLicenseBypass() || isCiTokenCached()) return 0;
  if (await verifyCiToken()) return 0;

  const cfg = loadLicenseClientConfig();
  if (!cfg.licenseKey || !cfg.controlPlaneUrl) {
    console.error(formatProRequiredMessage(feature));
    return 1;
  }

  await exitUnlessProFeature(feature);
  return 0;
}
