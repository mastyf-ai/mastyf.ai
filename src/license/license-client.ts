import { Logger } from '../utils/logger.js';
import {
  isCiLicenseBypass,
  isOpenCoreEnabled,
  isProFeature,
  licenseTier,
} from './feature-tiers.js';
import { isCiTokenCached } from './ci-token.js';

export type LicenseState = {
  licensed: boolean;
  tenantSlug: string;
  orgId?: string;
  orgName?: string;
  status: string;
  features: string[];
  expiresAt: string | null;
  graceUntil: string | null;
  cloudBillingUrl: string;
  checkedAt: number;
};

export type LicenseClientConfig = {
  controlPlaneUrl?: string;
  licenseKey?: string;
  requireLicense: boolean;
  refreshSeconds: number;
  graceSeconds: number;
  fetchFn?: typeof fetch;
};

const GCP_PREFIX = 'gcp_';

let singleton: LicenseClient | null = null;

export function isCloudLicenseKey(key: string): boolean {
  return key.startsWith(GCP_PREFIX);
}

export function loadLicenseClientConfig(): LicenseClientConfig {
  return {
    controlPlaneUrl: process.env['GUARDIAN_CONTROL_PLANE_URL']?.replace(/\/$/, ''),
    licenseKey: process.env['GUARDIAN_LICENSE_KEY'],
    requireLicense: process.env['GUARDIAN_REQUIRE_LICENSE'] === 'true',
    refreshSeconds: parseInt(process.env['GUARDIAN_LICENSE_REFRESH_SECONDS'] || '300', 10) || 300,
    graceSeconds: parseInt(process.env['GUARDIAN_LICENSE_GRACE_SECONDS'] || '900', 10) || 900,
  };
}

export function isLicenseEnforcementEnabled(): boolean {
  return process.env['GUARDIAN_REQUIRE_LICENSE'] === 'true';
}

export function getLicenseClient(): LicenseClient {
  if (!singleton) {
    singleton = new LicenseClient(loadLicenseClientConfig());
  }
  return singleton;
}

export function resetLicenseClientForTests(): void {
  if (singleton) {
    singleton.stop();
    singleton = null;
  }
}

type LicenseChangeListener = (state: LicenseState | null) => void;

export class LicenseClient {
  private config: LicenseClientConfig;
  private state: LicenseState | null = null;
  private lastGoodState: LicenseState | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<LicenseChangeListener>();
  private fetchFn: typeof fetch;

  constructor(config: LicenseClientConfig) {
    this.config = config;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  onChange(listener: LicenseChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  getState(): LicenseState | null {
    return this.state;
  }

  isLicensed(): boolean {
    if (isCiLicenseBypass() || isCiTokenCached()) return true;
    if (!this.isEnabled()) return false;
    if (this.state?.licensed) return true;
    if (this.lastGoodState && this.isWithinGrace()) return true;
    return false;
  }

  getTier(): 'community' | 'pro' {
    return licenseTier(this.isLicensed());
  }

  hasFeature(feature: string): boolean {
    if (isCiLicenseBypass() || isCiTokenCached()) return true;
    if (!isProFeature(feature)) return true;
    if (!isOpenCoreEnabled()) return false;
    return this.isLicensed();
  }

  getTenantSlug(): string | undefined {
    return this.state?.tenantSlug ?? this.lastGoodState?.tenantSlug;
  }

  getCloudBillingUrl(): string | undefined {
    return this.state?.cloudBillingUrl ?? this.lastGoodState?.cloudBillingUrl;
  }

  isEnabled(): boolean {
    return !!(this.config.controlPlaneUrl && this.config.licenseKey);
  }

  requiresLicense(): boolean {
    return this.config.requireLicense && this.isEnabled();
  }

  matchesLicenseKey(key: string): boolean {
    return !!this.config.licenseKey && this.config.licenseKey === key;
  }

  private isWithinGrace(): boolean {
    if (!this.lastGoodState) return false;
    const graceMs = this.config.graceSeconds * 1000;
    return Date.now() - this.lastGoodState.checkedAt <= graceMs;
  }

  async refresh(): Promise<LicenseState | null> {
    if (!this.isEnabled()) {
      this.state = null;
      this.notify();
      return null;
    }

    const url = `${this.config.controlPlaneUrl}/api/v1/license`;
    try {
      const res = await this.fetchFn(url, {
        headers: { Authorization: `Bearer ${this.config.licenseKey}` },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        Logger.warn(`[license] Control plane returned ${res.status}`);
        this.applyFailedCheck();
        return this.state;
      }

      const data = (await res.json()) as Omit<LicenseState, 'checkedAt'>;
      this.state = { ...data, checkedAt: Date.now() };
      if (this.state.licensed) {
        this.lastGoodState = this.state;
      }
      this.notify();
      return this.state;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[license] Refresh failed: ${message}`);
      this.applyFailedCheck();
      return this.state;
    }
  }

  private applyFailedCheck(): void {
    if (this.lastGoodState && this.isWithinGrace()) {
      this.state = {
        ...this.lastGoodState,
        licensed: true,
        checkedAt: Date.now(),
      };
    } else {
      this.state = {
        licensed: false,
        tenantSlug: this.lastGoodState?.tenantSlug ?? 'default',
        status: 'unreachable',
        features: [],
        expiresAt: null,
        graceUntil: null,
        cloudBillingUrl: this.lastGoodState?.cloudBillingUrl ?? '',
        checkedAt: Date.now(),
      };
    }
    this.notify();
  }

  async start(): Promise<boolean> {
    if (!this.isEnabled()) {
      if (this.config.requireLicense) {
        Logger.error(
          '[license] GUARDIAN_REQUIRE_LICENSE=true but GUARDIAN_CONTROL_PLANE_URL/GUARDIAN_LICENSE_KEY missing',
        );
        return false;
      }
      if (isOpenCoreEnabled()) {
        Logger.info(
          '[license] Community tier — Pro features (dashboard, swarm, multi-tenant, semantic async) require GUARDIAN_LICENSE_KEY',
        );
      }
      return true;
    }

    await this.refresh();

    if (isLicenseEnforcementEnabled() && this.config.requireLicense && !this.isLicensed()) {
      Logger.error('[license] License enforcement failed — dashboard and WebSocket disabled');
      return false;
    }

    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, this.config.refreshSeconds * 1000);

    return true;
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async exchangeCloudToken(token: string): Promise<{
    sessionToken: string;
    tenantSlug: string;
    features: string[];
    cloudBillingUrl: string;
  } | null> {
    if (!this.config.controlPlaneUrl) return null;

    const url = `${this.config.controlPlaneUrl}/api/v1/license/exchange`;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      return (await res.json()) as {
        sessionToken: string;
        tenantSlug: string;
        features: string[];
        cloudBillingUrl: string;
      };
    } catch {
      return null;
    }
  }
}
