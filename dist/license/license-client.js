import { existsSync, readFileSync } from 'node:fs';
import { Logger } from '../utils/logger.js';
import { allProFeatureNames, isCiLicenseBypass, isOpenCoreEnabled, isProFeature, licenseTier, } from './feature-tiers.js';
import { isCiTokenCached } from './ci-token.js';
import { looksLikeLemonKey, readOfflinePublicKey, verifyOfflineLicenseToken, } from './offline-license.js';
const GCP_PREFIX = 'gcp_';
let singleton = null;
export function isCloudLicenseKey(key) {
    return key.startsWith(GCP_PREFIX);
}
function readOfflineLicenseKeyFromFile() {
    const file = process.env['MASTYF_AI_LICENSE_FILE'];
    if (!file || !existsSync(file))
        return process.env['MASTYF_AI_OFFLINE_LICENSE_KEY'];
    try {
        const rec = JSON.parse(readFileSync(file, 'utf8'));
        return rec.token || process.env['MASTYF_AI_OFFLINE_LICENSE_KEY'];
    }
    catch {
        return process.env['MASTYF_AI_OFFLINE_LICENSE_KEY'];
    }
}
export function loadLicenseClientConfig() {
    return {
        controlPlaneUrl: process.env['MASTYF_AI_CONTROL_PLANE_URL']?.replace(/\/$/, ''),
        licenseKey: process.env['MASTYF_AI_LICENSE_KEY'],
        requireLicense: process.env['MASTYF_AI_REQUIRE_LICENSE'] === 'true',
        refreshSeconds: parseInt(process.env['MASTYF_AI_LICENSE_REFRESH_SECONDS'] || '300', 10) || 300,
        graceSeconds: parseInt(process.env['MASTYF_AI_LICENSE_GRACE_SECONDS'] || '900', 10) || 900,
        offlineLicenseKey: readOfflineLicenseKeyFromFile(),
        offlinePublicKey: readOfflinePublicKey(process.env['MASTYF_AI_LICENSE_PUBLIC_KEY']),
        machineId: process.env['MASTYF_AI_LICENSE_MACHINE_ID'],
    };
}
export function isLicenseEnforcementEnabled() {
    return process.env['MASTYF_AI_REQUIRE_LICENSE'] === 'true';
}
export function getLicenseClient() {
    if (!singleton) {
        singleton = new LicenseClient(loadLicenseClientConfig());
    }
    return singleton;
}
export function resetLicenseClientForTests() {
    if (singleton) {
        singleton.stop();
        singleton = null;
    }
}
export class LicenseClient {
    config;
    state = null;
    lastGoodState = null;
    refreshTimer = null;
    listeners = new Set();
    fetchFn;
    constructor(config) {
        this.config = config;
        this.fetchFn = config.fetchFn ?? fetch;
    }
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    notify() {
        for (const listener of this.listeners) {
            listener(this.state);
        }
    }
    getState() {
        return this.state;
    }
    isLicensed() {
        if (isCiLicenseBypass() || isCiTokenCached())
            return true;
        // Open source: all features unlocked unless cloud license enforcement is on.
        if (!isLicenseEnforcementEnabled())
            return true;
        if (this.state?.licensed)
            return true;
        if (this.lastGoodState && this.isWithinGrace())
            return true;
        if (this.applyOfflineLicense())
            return true;
        if (this.applyLemonLicense())
            return true;
        if (!this.isEnabled())
            return false;
        return false;
    }
    getTier() {
        return licenseTier(this.isLicensed());
    }
    hasFeature(_feature) {
        if (isCiLicenseBypass() || isCiTokenCached())
            return true;
        // Open source (default): every feature is available without a license key.
        if (!isLicenseEnforcementEnabled())
            return true;
        if (!isProFeature(_feature))
            return true;
        if (!isOpenCoreEnabled())
            return false;
        return this.isLicensed();
    }
    getTenantSlug() {
        return this.state?.tenantSlug ?? this.lastGoodState?.tenantSlug;
    }
    getCloudBillingUrl() {
        return this.state?.cloudBillingUrl ?? this.lastGoodState?.cloudBillingUrl;
    }
    isEnabled() {
        return !!(this.config.controlPlaneUrl && this.config.licenseKey) || this.hasOfflineLicense();
    }
    hasOfflineLicense() {
        return Boolean(this.config.offlineLicenseKey && this.config.offlinePublicKey);
    }
    applyLemonLicense() {
        const key = this.config.licenseKey || process.env['MASTYF_LICENSE_KEY'] || '';
        if (process.env['MASTYF_AI_PACKAGED'] !== 'true')
            return false;
        if (!looksLikeLemonKey(key))
            return false;
        this.state = {
            licensed: true,
            tenantSlug: 'lemon',
            status: 'lemon-store',
            features: [...allProFeatureNames()],
            expiresAt: null,
            graceUntil: null,
            cloudBillingUrl: process.env['MASTYF_SHIELD_STORE_URL'] || 'https://mastyfai.lemonsqueezy.com/',
            checkedAt: Date.now(),
        };
        this.lastGoodState = this.state;
        return true;
    }
    applyOfflineLicense() {
        if (!this.hasOfflineLicense())
            return false;
        const result = verifyOfflineLicenseToken(String(this.config.offlineLicenseKey), String(this.config.offlinePublicKey), Date.now(), this.config.machineId || '');
        if (!result.ok)
            return false;
        this.state = {
            licensed: true,
            tenantSlug: result.payload?.sub || result.payload?.email || 'shield',
            orgName: result.payload?.email,
            status: result.grace ? 'offline-grace' : 'offline-active',
            features: [...allProFeatureNames()],
            expiresAt: result.expiresAt || null,
            graceUntil: null,
            cloudBillingUrl: process.env['MASTYF_SHIELD_STORE_URL'] || '',
            checkedAt: Date.now(),
        };
        this.lastGoodState = this.state;
        return true;
    }
    requiresLicense() {
        return this.config.requireLicense && this.isEnabled();
    }
    matchesLicenseKey(key) {
        return !!this.config.licenseKey && this.config.licenseKey === key;
    }
    isWithinGrace() {
        if (!this.lastGoodState)
            return false;
        const graceMs = this.config.graceSeconds * 1000;
        return Date.now() - this.lastGoodState.checkedAt <= graceMs;
    }
    async refresh() {
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
            const data = (await res.json());
            this.state = { ...data, checkedAt: Date.now() };
            if (this.state.licensed) {
                this.lastGoodState = this.state;
            }
            this.notify();
            return this.state;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.warn(`[license] Refresh failed: ${message}`);
            this.applyFailedCheck();
            return this.state;
        }
    }
    applyFailedCheck() {
        if (this.lastGoodState && this.isWithinGrace()) {
            this.state = {
                ...this.lastGoodState,
                licensed: true,
                checkedAt: Date.now(),
            };
        }
        else {
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
    async start() {
        if (this.hasOfflineLicense() && this.applyOfflineLicense()) {
            Logger.info('[license] Offline Shield license accepted');
            return true;
        }
        if (this.applyLemonLicense()) {
            Logger.info('[license] Lemon Squeezy license accepted in packaged Shield');
            return true;
        }
        if (!this.isEnabled()) {
            if (this.config.requireLicense) {
                Logger.error('[license] MASTYF_AI_REQUIRE_LICENSE=true but no offline license and no control-plane key');
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
        if (this.refreshTimer)
            clearInterval(this.refreshTimer);
        this.refreshTimer = setInterval(() => {
            void this.refresh();
        }, this.config.refreshSeconds * 1000);
        return true;
    }
    stop() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
    async exchangeCloudToken(token) {
        if (!this.config.controlPlaneUrl)
            return null;
        const url = `${this.config.controlPlaneUrl}/api/v1/license/exchange`;
        try {
            const res = await this.fetchFn(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
                signal: AbortSignal.timeout(15000),
            });
            if (!res.ok)
                return null;
            return (await res.json());
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=license-client.js.map