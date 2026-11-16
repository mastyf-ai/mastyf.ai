// The free service has no licence: every paid feature check says no, and nothing is ever fetched.
export type LicenseState = Record<string, unknown>;
export type LicenseClientConfig = Record<string, unknown>;
export type CloudExchangeResult = Record<string, unknown>;
export class LicenseClient {
  hasFeature(_feature: string): boolean { return false; }
  isPaid(): boolean { return false; }
  getState(): null { return null; }
  onChange(_listener: unknown): () => void { return () => {}; }
  async start(): Promise<void> {}
  stop(): void {}
}
const client = new LicenseClient();
export function getLicenseClient(): LicenseClient { return client; }
export function isCloudLicenseKey(_key: string): boolean { return false; }
export function loadLicenseClientConfig(): LicenseClientConfig { return {}; }
export function isLicenseEnforcementEnabled(): boolean { return false; }
export function setPaidPlanForTests(_paid: boolean | null): void {}
export function resetLicenseClientForTests(): void {}
export function cloudApiKey(): null { return null; }

/** Marks this as the free service's stand-in (checked by the tests). */
export const __mastyfCheckStub = true;
