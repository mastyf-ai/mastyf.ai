/**
 * Google Cloud Marketplace Partner Procurement API Client
 *
 * Implements the lifecycle handshake for Cloud Commerce Partner Procurement API (v1):
 * https://cloud.google.com/marketplace/docs/partners/integrated-saas/procurement-api-ref
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

let cachedSaToken: { token: string; expiresAt: number } | null = null;

async function mintServiceAccountAccessToken(saJsonOrB64: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedSaToken && cachedSaToken.expiresAt > now + 60) {
    return cachedSaToken.token;
  }

  let sa: { client_email?: string; private_key?: string };
  try {
    const raw = saJsonOrB64.trim().startsWith('{')
      ? saJsonOrB64.trim()
      : Buffer.from(saJsonOrB64.trim(), 'base64').toString('utf8');
    sa = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`Failed to parse GCP service account JSON: ${err.message}`);
  }

  if (!sa.client_email || !sa.private_key) {
    throw new Error('GCP service account JSON is missing client_email or private_key');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsignedToken = `${b64Header}.${b64Payload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  const signature = signer.sign(sa.private_key, 'base64url');
  const jwt = `${unsignedToken}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Failed to exchange GCP service account key for OAuth access token: ${errText}`);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in || 3600;
  cachedSaToken = { token: accessToken, expiresAt: now + expiresIn };
  return accessToken;
}

const PROCUREMENT_BASE_URL = 'https://cloudcommerceprocurement.googleapis.com/v1';

export interface GcpAccount {
  name: string; // e.g. "providers/mastyf/accounts/acc-12345"
  createTime?: string;
  updateTime?: string;
  state?: 'ACCOUNT_STATE_UNSPECIFIED' | 'ACCOUNT_PENDING_APPROVAL' | 'ACCOUNT_ACTIVE' | 'ACCOUNT_DELETED';
  billingAccountId?: string;
  approvals?: Array<{
    name: string;
    state: string;
    updateTime: string;
  }>;
}

export interface GcpEntitlement {
  name: string; // e.g. "providers/mastyf/entitlements/ent-12345"
  account: string; // Reference to account name
  product?: string;
  plan?: string;
  state?:
    | 'ENTITLEMENT_STATE_UNSPECIFIED'
    | 'ENTITLEMENT_ACTIVATION_REQUESTED'
    | 'ENTITLEMENT_ACTIVE'
    | 'ENTITLEMENT_PENDING_CANCELLATION'
    | 'ENTITLEMENT_CANCELLED'
    | 'ENTITLEMENT_PENDING_PLAN_CHANGE'
    | 'ENTITLEMENT_SUSPENDED';
  usageReportingId?: string;
  createTime?: string;
  updateTime?: string;
}

export interface ResolveAccountResponse {
  account: string; // e.g. "providers/mastyf/accounts/acc-12345"
}

export class GcpProcurementClient {
  private explicitProviderId?: string;

  constructor(providerId?: string) {
    this.explicitProviderId = providerId;
  }

  getProviderId(): string {
    return this.explicitProviderId || process.env.GCP_MARKETPLACE_PROVIDER_ID || 'mastyf';
  }

  /**
   * Retrieves a valid GCP OAuth2 Access Token.
   * Priority order:
   * 1. Environment variable GCP_MARKETPLACE_ACCESS_TOKEN
   * 2. Compute metadata server (when running on Cloud Run or GCE)
   * 3. Local gcloud CLI fallback (development mode)
   */
  async getAccessToken(): Promise<string> {
    if (process.env.GCP_MARKETPLACE_ACCESS_TOKEN?.trim()) {
      return process.env.GCP_MARKETPLACE_ACCESS_TOKEN.trim();
    }

    const saKey =
      process.env.GCP_SERVICE_ACCOUNT_KEY?.trim() ||
      process.env.GCP_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
    if (saKey) {
      try {
        return await mintServiceAccountAccessToken(saKey);
      } catch (err) {
        console.warn('[GCP Procurement] Service account token minting warning:', err);
      }
    }

    // Try Cloud Run / Compute Engine metadata server
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (data.access_token) {
          return data.access_token;
        }
      }
    } catch {
      // Not on GCP or metadata server unreachable
    }

    // Local development fallback via gcloud
    try {
      const token = execSync('gcloud auth print-access-token', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      }).trim();
      if (token) return token;
    } catch {
      // gcloud not available or not logged in
    }

    if (process.env.NODE_ENV === 'test') {
      return 'mock-test-gcp-token';
    }

    throw new Error(
      'Unable to acquire GCP Access Token for Cloud Commerce Procurement API. Configure GCP_MARKETPLACE_ACCESS_TOKEN or run in a GCP environment.'
    );
  }

  private normalizeResourceName(type: 'accounts' | 'entitlements', nameOrId: string): string {
    // Only accept this provider's own resource names, so the id cannot steer the
    // request path (e.g. "../" or "?") to another Procurement endpoint.
    const id = nameOrId.startsWith('providers/')
      ? nameOrId.slice(`providers/${this.getProviderId()}/${type}/`.length)
      : nameOrId;
    if (
      (nameOrId.startsWith('providers/') &&
        !nameOrId.startsWith(`providers/${this.getProviderId()}/${type}/`)) ||
      !/^[A-Za-z0-9_-]+$/.test(id)
    ) {
      throw new Error(`Invalid GCP ${type} resource name: ${nameOrId}`);
    }
    return `providers/${this.getProviderId()}/${type}/${encodeURIComponent(id)}`;
  }

  /**
   * Resolves a customer JWT token (from ?x-gcp-marketplace-token=... or ?jwt=...)
   * into a Google Account resource name.
   */
  async resolveAccount(jwtToken: string): Promise<ResolveAccountResponse> {
    const token = await this.getAccessToken();
    const url = `${PROCUREMENT_BASE_URL}/providers/${this.getProviderId()}/accounts:resolve`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: jwtToken }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to resolve GCP account (${res.status}): ${errBody}`);
    }

    return (await res.json()) as ResolveAccountResponse;
  }

  /**
   * Fetches an Account from Google Cloud Commerce.
   */
  async getAccount(accountNameOrId: string): Promise<GcpAccount> {
    const token = await this.getAccessToken();
    const resourceName = this.normalizeResourceName('accounts', accountNameOrId);
    const url = `${PROCUREMENT_BASE_URL}/${resourceName}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to get GCP account ${resourceName} (${res.status}): ${errBody}`);
    }

    return (await res.json()) as GcpAccount;
  }

  /**
   * Approves an Account creation.
   */
  async approveAccount(accountNameOrId: string, approvalName: string = 'signup'): Promise<void> {
    const token = await this.getAccessToken();
    const resourceName = this.normalizeResourceName('accounts', accountNameOrId);
    const url = `${PROCUREMENT_BASE_URL}/${resourceName}:approve`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ approvalName }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to approve GCP account ${resourceName} (${res.status}): ${errBody}`);
    }
  }

  /**
   * Fetches an Entitlement from Google Cloud Commerce.
   */
  async getEntitlement(entitlementNameOrId: string): Promise<GcpEntitlement> {
    const token = await this.getAccessToken();
    const resourceName = this.normalizeResourceName('entitlements', entitlementNameOrId);
    const url = `${PROCUREMENT_BASE_URL}/${resourceName}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to get GCP entitlement ${resourceName} (${res.status}): ${errBody}`);
    }

    return (await res.json()) as GcpEntitlement;
  }

  /**
   * Approves an Entitlement creation or pending change.
   */
  async approveEntitlement(entitlementNameOrId: string): Promise<void> {
    const token = await this.getAccessToken();
    const resourceName = this.normalizeResourceName('entitlements', entitlementNameOrId);
    const url = `${PROCUREMENT_BASE_URL}/${resourceName}:approve`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to approve GCP entitlement ${resourceName} (${res.status}): ${errBody}`);
    }
  }

  /**
   * Rejects an Entitlement.
   */
  async rejectEntitlement(entitlementNameOrId: string, reason: string): Promise<void> {
    const token = await this.getAccessToken();
    const resourceName = this.normalizeResourceName('entitlements', entitlementNameOrId);
    const url = `${PROCUREMENT_BASE_URL}/${resourceName}:reject`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to reject GCP entitlement ${resourceName} (${res.status}): ${errBody}`);
    }
  }

  /**
   * Suspends an Entitlement.
   */
  async suspendEntitlement(entitlementNameOrId: string, reason: string): Promise<void> {
    const token = await this.getAccessToken();
    const resourceName = this.normalizeResourceName('entitlements', entitlementNameOrId);
    const url = `${PROCUREMENT_BASE_URL}/${resourceName}:suspend`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to suspend GCP entitlement ${resourceName} (${res.status}): ${errBody}`);
    }
  }
}

export const gcpProcurement = new GcpProcurementClient();
