import type { Router, Request, Response } from 'express';
import type { FederationStore, InMemoryFederationStore } from './federation-store.js';
import type { DbFederationStore } from './db-federation-store.js';
import type { IdpConfig } from './federation-types.js';
import { startOidcLogin, handleOidcCallback } from './oidc-provider.js';
import type { FederatedUserData } from './federation-types.js';
import { createAttemptLimiter } from '../attempt-limiter.js';

interface FederationRouteDeps {
  federationStore: FederationStore | InMemoryFederationStore | DbFederationStore;
  userStore: {
    findByIdpUser: (idpProvider: string, idpUserId: string, tenantId: string) => Promise<Record<string, unknown> | null>;
    createFromIdp: (data: {
      tenantId: string;
      username: string;
      email: string;
      displayName: string;
      idpProvider: string;
      idpUserId: string;
      roles: string[];
    }) => Promise<Record<string, unknown>>;
    updateIdpTokens: (userId: string, accessToken: string, refreshToken: string | undefined, expiresAt: number | undefined) => Promise<void>;
  };
  sessionStore: {
    create: (userId: string, ipAddress: string, userAgent: string, tenantId: string) => Promise<{ token: string; expiresAt: string }>;
  };
}

interface SsoStateEntry {
  providerId: string;
  codeVerifier: string;
  nonce: string;
  state: string;
  tenantId: string;
  expiresAt: number;
}

const SSO_STATE = new Map<string, SsoStateEntry>();

function storeSsoState(state: string, providerId: string, codeVerifier: string, nonce: string, tenantId: string): void {
  SSO_STATE.set(state, {
    providerId,
    codeVerifier,
    nonce,
    state,
    tenantId,
    expiresAt: Date.now() + 600_000,
  });
}

function getSsoState(state: string): SsoStateEntry | undefined {
  const entry = SSO_STATE.get(state);
  if (!entry || entry.expiresAt < Date.now()) {
    SSO_STATE.delete(state);
    return undefined;
  }
  SSO_STATE.delete(state);
  return entry;
}

function getTenantId(req: Request): string {
  return (req as any).tenantId || 'default';
}

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

function query(req: Request, name: string): string | undefined {
  const val = req.query[name];
  if (Array.isArray(val)) return val[0] as string;
  return val as string | undefined;
}

const SAML_UNAVAILABLE =
  'SAML sign-in is not available in this version. Use an OIDC provider for single sign-on.';

export function registerFederationRoutes(router: Router, deps: FederationRouteDeps): void {
  // SSO start and callback are unauthenticated and each start stores state, so cap them per address.
  const ssoAttempts = createAttemptLimiter({ max: 30, windowMs: 15 * 60 * 1000 });

  router.get('/api/auth/sso/providers', async (req: Request, res: Response) => {
    try {
      const providers = await deps.federationStore.getEnabledProvidersForTenant(getTenantId(req));
      const safeProviders = providers.map(p => ({
        id: p.id,
        name: p.name,
        providerType: p.providerType,
      }));
      res.json({ providers: safeProviders });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list SSO providers', message: err.message });
    }
  });

  router.get('/api/auth/sso/login/:providerId', ssoAttempts, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const providerId = param(req, 'providerId');
      const config = await deps.federationStore.getIdpConfig(tenantId, providerId);

      if (!config || !config.enabled) {
        res.status(404).json({ error: 'SSO provider not found or disabled' });
        return;
      }

      if (config.providerType === 'oidc') {
        const { authorizationUrl, state, codeVerifier, nonce } = await startOidcLogin(config);
        storeSsoState(state, config.id, codeVerifier, nonce, tenantId);
        res.redirect(302, authorizationUrl);
      } else if (config.providerType === 'saml') {
        res.status(501).json({ error: SAML_UNAVAILABLE });
      }
    } catch (err: any) {
      res.status(500).json({ error: 'SSO login failed', message: err.message });
    }
  });

  router.get('/api/auth/sso/callback/:providerId', ssoAttempts, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const providerId = param(req, 'providerId');
      const config = await deps.federationStore.getIdpConfig(tenantId, providerId);

      if (!config || !config.enabled) {
        res.status(404).json({ error: 'SSO provider not found or disabled' });
        return;
      }

      if (config.providerType === 'saml') {
        res.status(501).json({ error: SAML_UNAVAILABLE });
        return;
      }

      const code = query(req, 'code');
      const state = query(req, 'state');

      if (!code || !state) {
        res.status(400).json({ error: 'Missing authorization code or state' });
        return;
      }

      const ssoState = getSsoState(state);
      if (!ssoState) {
        res.status(400).json({ error: 'Invalid or expired SSO session' });
        return;
      }

      if (ssoState.providerId !== config.id) {
        res.status(400).json({ error: 'Provider mismatch' });
        return;
      }

      const federatedUser = await handleOidcCallback(
        config, code, state, ssoState.state, ssoState.codeVerifier, ssoState.nonce,
      );

      let user = await deps.userStore.findByIdpUser(
        federatedUser.idpProvider, federatedUser.idpUserId, tenantId,
      );

      if (!user) {
        const username = federatedUser.email || `${federatedUser.idpProvider}_${federatedUser.idpUserId}`;
        user = await deps.userStore.createFromIdp({
          tenantId,
          username,
          email: federatedUser.email,
          displayName: federatedUser.displayName,
          idpProvider: federatedUser.idpProvider,
          idpUserId: federatedUser.idpUserId,
          roles: federatedUser.mappedRoles,
        });
      }

      if (federatedUser.accessToken) {
        await deps.userStore.updateIdpTokens(
          user.id as string, federatedUser.accessToken,
          federatedUser.refreshToken, federatedUser.tokenExpiresAt,
        );
      }

      const session = await deps.sessionStore.create(
        user.id as string, req.ip || '127.0.0.1',
        req.headers['user-agent'] || '', tenantId,
      );

      res.cookie('mastyf_ai_session', session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      res.redirect(302, '/?sso=success');
    } catch (err: any) {
      res.status(500).json({ error: 'SSO callback failed', message: err.message });
    }
  });

  router.get('/api/auth/sso/settings', async (req: Request, res: Response) => {
    try {
      const configs = await deps.federationStore.listIdpConfigs(getTenantId(req));
      res.json({ configs });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list SSO settings', message: err.message });
    }
  });

  router.post('/api/auth/sso/settings', async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const config: IdpConfig = {
        ...req.body,
        tenantId,
        id: req.body.id || `idp_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const created = await deps.federationStore.createIdpConfig(config);
      res.status(201).json({ config: created });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create SSO config', message: err.message });
    }
  });

  router.put('/api/auth/sso/settings/:configId', async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const updated = await deps.federationStore.updateIdpConfig(tenantId, param(req, 'configId'), req.body);
      if (!updated) {
        res.status(404).json({ error: 'SSO config not found' });
        return;
      }
      res.json({ config: updated });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update SSO config', message: err.message });
    }
  });

  router.delete('/api/auth/sso/settings/:configId', async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const deleted = await deps.federationStore.deleteIdpConfig(tenantId, param(req, 'configId'));
      if (!deleted) {
        res.status(404).json({ error: 'SSO config not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete SSO config', message: err.message });
    }
  });
}
