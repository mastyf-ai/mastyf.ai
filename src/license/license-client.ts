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
  /** Whether the workspace is on a paid plan. Absent from older control planes, which reads as no. */
  paid?: boolean;
  tier?: string;
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
let paidPlanForTests: boolean | null = null;

export function isCloudLicenseKey(key: string): boolean {
  return key.startsWith(GCP_PREFIX);
}

export function loadLicenseClientConfig(): LicenseClientConfig {
  return {
    controlPlaneUrl: process.env['MASTYF_AI_CONTROL_PLANE_URL']?.replace(/\/$/, ''),
    licenseKey: process.env['MASTYF_AI_LICENSE_KEY']?.trim() || process.env['MASTYF_AI_CLOUD_API_KEY']?.trim(),
    requireLicense: process.env['MASTYF_AI_REQUIRE_LICENSE'] === 'true',
    refreshSeconds: parseInt(process.env['MASTYF_AI_LICENSE_REFRESH_SECONDS'] || '300', 10) || 300,
    graceSeconds: parseInt(process.env['MASTYF_AI_LICENSE_GRACE_SECONDS'] || '900', 10) || 900,
  };
}

export function isLicenseEnforcementEnabled(): boolean {
  return process.env['MASTYF_AI_REQUIRE_LICENSE'] === 'true';
}

export function getLicenseClient(): LicenseClient {
  if (!singleton) {
    singleton = new LicenseClient(loadLicenseClientConfig());
  }
  return singleton;
}

/** There is deliberately no setting that does this outside a test. */
export function setPaidPlanForTests(paid: boolean | null): void {
  paidPlanForTests = paid;
}

export function resetLicenseClientForTests(): void {
  paidPlanForTests = null;
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
    // Open source: all features unlocked unless cloud license enforcement is on.
    if (!isLicenseEnforcementEnabled()) return true;
    if (!this.isEnabled()) return false;
    if (this.state?.licensed) return true;
    if (this.lastGoodState && this.isWithinGrace()) return true;
    return false;
  }

  getTier(): 'community' | 'pro' {
    return licenseTier(this.isLicensed());
  }

  hasFeature(_feature: string): boolean {
    if (isCiLicenseBypass() || isCiTokenCached()) return true;
    // Open source (default): every feature is available without a license key.
    if (!isLicenseEnforcementEnabled()) return true;
    if (!isProFeature(_feature)) return true;
    if (!isOpenCoreEnabled()) return false;
    return this.isLicensed();
  }

  /**
   * Only the control plane's answer counts; the bypass settings above don't apply. An outage never
   * removes protection from a running proxy, so the last answer stands until the control plane gives
   * a new one. Only a clear answer (not paid, or a rejected key) turns the paid layers off.
   */
  hasPaidPlan(): boolean {
    if (paidPlanForTests !== null) return paidPlanForTests;
    if (!this.controlPlaneIsSecure()) return false;
    if (this.state?.status === 'unreachable') return this.lastGoodState?.paid === true;
    return this.state?.paid === true;
  }

  /**
   * Over plain HTTP, anyone on the network could answer "not paid" and turn a customer's protection
   * off, so the plan is only read over HTTPS or from this machine.
   */
  controlPlaneIsSecure(): boolean {
    try {
      const url = new URL(this.config.controlPlaneUrl ?? '');
      return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch {
      return false;
    }
  }

  controlPlaneUnreachable(): boolean {
    return this.state?.status === 'unreachable';
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
    const wasPaid = this.hasPaidPlan();
    const state = await this.fetchState();
    if (wasPaid && !this.hasPaidPlan()) {
      Logger.error('[license] This workspace is no longer on a paid plan. Paid features are now off.');
    }
    return state;
  }

  private async fetchState(): Promise<LicenseState | null> {
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

      // Only the control plane's own rejection counts as one. A CDN or firewall can also send a bare
      // 401 or 403 during an incident, and that must not turn off a customer's protection.
      const rejection = res.status === 401 ? ((await res.clone().json().catch(() => null)) as Partial<LicenseState> | null) : null;
      if (rejection?.status === 'invalid_key' && rejection.licensed === false) {
        Logger.warn('[license] Control plane rejected the key');
        this.lastGoodState = null;
        this.state = {
          licensed: false,
          tenantSlug: 'default',
          status: 'invalid_key',
          features: [],
          expiresAt: null,
          graceUntil: null,
          cloudBillingUrl: '',
          checkedAt: Date.now(),
        };
        this.notify();
        return this.state;
      }

      if (!res.ok) {
        Logger.warn(`[license] Control plane returned ${res.status}`);
        this.applyFailedCheck();
        return this.state;
      }

      const data = (await res.json()) as Omit<LicenseState, 'checkedAt'>;
      // Something that isn't a real answer about the plan can't end a paid plan either.
      if (this.lastGoodState?.paid === true && typeof data.paid !== 'boolean') {
        Logger.warn('[license] Control plane reply did not say whether the plan is paid');
        this.applyFailedCheck();
        return this.state;
      }
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
          '[license] MASTYF_AI_REQUIRE_LICENSE=true but MASTYF_AI_CONTROL_PLANE_URL/MASTYF_AI_LICENSE_KEY missing',
        );
        return false;
      }
      if (isOpenCoreEnabled()) {
        Logger.info('[license] MIT open source — all features available without a license key');
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
    this.refreshTimer.unref?.();

    return true;
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Redeems a "Launch dashboard" token with the control plane, authenticated by this
   * workspace's API key. The cloud returns who is signing in directly over this HTTPS call,
   * so no cloud secret has to live on this host. `session` is absent from older control
   * planes, which sent an HMAC-signed `sessionToken` instead.
   */
  async exchangeCloudToken(token: string): Promise<CloudExchangeResult | null> {
    if (!this.config.controlPlaneUrl) return null;
    const apiKey = cloudApiKey();
    if (!apiKey) return null;

    const url = `${this.config.controlPlaneUrl}/api/v1/license/exchange`;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      return (await res.json()) as CloudExchangeResult;
    } catch {
      return null;
    }
  }
}

export type CloudExchangeResult = {
  session?: { tenantSlug: string; identity: string; roles: string[]; exp: number };
  /** Legacy control planes only. */
  sessionToken?: string;
  tenantSlug: string;
  features: string[];
  cloudBillingUrl: string;
};

/** The workspace API key this proxy uses with the control plane (as control-plane-client does). */
export function cloudApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env['MASTYF_AI_CLOUD_API_KEY']?.trim();
  if (explicit) return explicit;
  const licenseKey = env['MASTYF_AI_LICENSE_KEY']?.trim();
  return licenseKey && isCloudLicenseKey(licenseKey) ? licenseKey : null;
}
