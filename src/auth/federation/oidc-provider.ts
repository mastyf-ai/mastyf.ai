import crypto from 'node:crypto';
import type { IdpConfig, OidcDiscovery, OidcTokens, OidcIdTokenClaims, FederationSessionRequest, FederatedUserData } from './federation-types.js';
import * as jose from 'jose';

const DISCOVERY_CACHE = new Map<string, { data: OidcDiscovery; expiresAt: number }>();
const DISCOVERY_TTL_MS = 3_600_000; // 1 hour

async function discoverOidc(issuerUrl: string): Promise<OidcDiscovery> {
  const cached = DISCOVERY_CACHE.get(issuerUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = issuerUrl.endsWith('/.well-known/openid-configuration')
    ? issuerUrl
    : `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed for ${issuerUrl}: HTTP ${res.status}`);
  }

  const data = (await res.json()) as OidcDiscovery;
  DISCOVERY_CACHE.set(issuerUrl, { data, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return data;
}

export function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function computeCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function buildAuthorizationUrl(
  config: IdpConfig,
  discovery: OidcDiscovery,
  state: string,
  codeChallenge: string,
  nonce: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  config: IdpConfig,
  discovery: OidcDiscovery,
  code: string,
  codeVerifier: string,
  state: string,
): Promise<OidcTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Token exchange failed for provider ${config.name}: HTTP ${res.status} - ${errorBody.slice(0, 200)}`);
  }

  return (await res.json()) as OidcTokens;
}

export function decodeBase64JwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

export async function validateIdToken(
  idToken: string,
  config: IdpConfig,
  discovery: OidcDiscovery,
  expectedNonce: string,
): Promise<OidcIdTokenClaims> {
  const JWKS = jose.createRemoteJWKSet(new URL(discovery.jwks_uri));

  const { payload } = await jose.jwtVerify(idToken, JWKS, {
    issuer: discovery.issuer,
    audience: config.clientId,
    clockTolerance: 60,
  });

  const claims = payload as unknown as OidcIdTokenClaims;

  if (!claims.sub) {
    throw new Error('ID token missing sub claim');
  }

  if (claims.nonce && claims.nonce !== expectedNonce) {
    throw new Error('ID token nonce mismatch');
  }

  return claims;
}

export async function fetchUserinfo(
  discovery: OidcDiscovery,
  accessToken: string,
): Promise<Record<string, unknown> | null> {
  if (!discovery.userinfo_endpoint) return null;

  const res = await fetch(discovery.userinfo_endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) return null;

  return (await res.json()) as Record<string, unknown>;
}

export function extractFederatedUserData(
  config: IdpConfig,
  idTokenClaims: OidcIdTokenClaims,
  userinfo: Record<string, unknown> | null,
  tokens: OidcTokens,
): FederatedUserData {
  const resolveClaim = (claimPath: string): string => {
    const [source, ...parts] = claimPath.split('.');
    const obj = source === 'id_token' ? idTokenClaims : userinfo;
    if (!obj) return '';
    let value: unknown = obj;
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }
    return typeof value === 'string' ? value : '';
  };

  const email = resolveClaim(config.claimMappings.email) || idTokenClaims.email || '';
  const displayName = resolveClaim(config.claimMappings.displayName) || idTokenClaims.name || idTokenClaims.preferred_username || email;

  const groups = config.claimMappings.groups
    ? extractClaimAsArray(config.claimMappings.groups, idTokenClaims, userinfo)
    : (idTokenClaims.groups || []);
  const roles = config.claimMappings.roles
    ? extractClaimAsArray(config.claimMappings.roles, idTokenClaims, userinfo)
    : (idTokenClaims.roles || []);

  const mappedRoles = new Set<string>();
  for (const group of groups) {
    const mapped = config.roleMap[group];
    if (mapped) mappedRoles.add(mapped);
  }
  for (const role of roles) {
    const mapped = config.roleMap[role];
    if (mapped) mappedRoles.add(mapped);
  }

  return {
    idpProvider: config.id,
    idpUserId: idTokenClaims.sub,
    email,
    displayName: displayName || email,
    groups: groups as string[],
    roles: roles as string[],
    mappedRoles: [...mappedRoles],
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
  };
}

function extractClaimAsArray(
  claimPath: string,
  idTokenClaims: OidcIdTokenClaims,
  userinfo: Record<string, unknown> | null,
): string[] {
  const source = claimPath.startsWith('id_token.') ? idTokenClaims : userinfo;
  const key = claimPath.includes('.') ? claimPath.split('.').pop()! : claimPath;
  if (!source) return [];
  const value = (source as Record<string, unknown>)[key];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return [value];
  return [];
}

export async function startOidcLogin(
  config: IdpConfig,
): Promise<{ authorizationUrl: string; state: string; codeVerifier: string; nonce: string }> {
  const discovery = await discoverOidc(config.issuerUrl);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const nonce = generateNonce();
  const codeChallenge = computeCodeChallenge(codeVerifier);

  const authorizationUrl = buildAuthorizationUrl(config, discovery, state, codeChallenge, nonce);

  return { authorizationUrl, state, codeVerifier, nonce };
}

export async function handleOidcCallback(
  config: IdpConfig,
  code: string,
  state: string,
  expectedState: string,
  codeVerifier: string,
  expectedNonce: string,
): Promise<FederatedUserData> {
  if (state !== expectedState) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const discovery = await discoverOidc(config.issuerUrl);
  const tokens = await exchangeCodeForTokens(config, discovery, code, codeVerifier, state);
  const idTokenClaims = await validateIdToken(tokens.id_token, config, discovery, expectedNonce);
  const userinfo = await fetchUserinfo(discovery, tokens.access_token);

  return extractFederatedUserData(config, idTokenClaims, userinfo, tokens);
}

export { discoverOidc };
