export type IdpProviderType = 'oidc' | 'saml';

export interface IdpConfig {
  id: string;
  tenantId: string;
  providerType: IdpProviderType;
  name: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  claimMappings: IdpClaimMappings;
  roleMap: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IdpClaimMappings {
  sub: string;
  email: string;
  displayName: string;
  groups?: string;
  roles?: string;
}

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
}

export interface OidcTokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface OidcIdTokenClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  picture?: string;
  groups?: string[];
  roles?: string[];
  [key: string]: unknown;
}

export interface UserinfoResponse {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  picture?: string;
  [key: string]: unknown;
}

export interface FederatedUserData {
  idpProvider: string;
  idpUserId: string;
  email: string;
  displayName: string;
  groups: string[];
  roles: string[];
  mappedRoles: string[];
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

export interface FederationSessionRequest {
  providerId: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
}

export interface FederationCallbackResult {
  federatedUser: FederatedUserData;
  sessionToken: string;
  isNewUser: boolean;
}
