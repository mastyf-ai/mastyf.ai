import crypto from 'node:crypto';

export interface SamlConfig {
  id: string;
  tenantId: string;
  name: string;
  issuerUrl: string;
  entryPoint: string;
  cert: string;
  privateKey?: string;
  redirectUri: string;
  claimMappings: { email: string; displayName: string; groups?: string };
  roleMap: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function generateSamlRequestUrl(config: SamlConfig): { url: string; relayState: string } {
  const id = `_${crypto.randomBytes(20).toString('hex')}`;
  const relayState = crypto.randomBytes(16).toString('hex');
  const instant = new Date().toISOString();

  const requestXml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    ID="${id}" Version="2.0" IssueInstant="${instant}"
    Destination="${config.entryPoint}" AssertionConsumerServiceURL="${config.redirectUri}"
    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
    <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${config.issuerUrl}</saml:Issuer>
    <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
    <samlp:RequestedAuthnContext Comparison="exact">
      <saml:AuthnContextClassRef xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
    </samlp:RequestedAuthnContext>
  </samlp:AuthnRequest>`;

  const deflated = deflateAndEncode(requestXml);
  const encoded = encodeURIComponent(deflated);
  const url = `${config.entryPoint}?SAMLRequest=${encoded}&RelayState=${relayState}`;

  return { url, relayState };
}

export async function parseSamlResponse(
  samlResponse: string,
  config: SamlConfig,
  expectedRelayState: string,
): Promise<{ email: string; displayName: string; groups: string[]; nameId: string } | null> {
  try {
    const decoded = Buffer.from(samlResponse, 'base64').toString('utf8');
    const emailMatch = decoded.match(/<saml:Attribute[^>]*Name="email"[^>]*>[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/i)
      || decoded.match(/email[^"]*"[^>]*>([^<]+)</i);
    const nameMatch = decoded.match(/<saml:Attribute[^>]*Name="displayName"[^>]*>[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/i)
      || decoded.match(/displayName[^"]*"[^>]*>([^<]+)</i);
    const nameIdMatch = decoded.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/i);

    const groups: string[] = [];
    const groupMatches = decoded.matchAll(/<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/gi);
    for (const m of groupMatches) {
      const val = m[1].trim();
      if (val && val.length < 200) groups.push(val);
    }

    return {
      email: emailMatch?.[1] || nameIdMatch?.[1] || '',
      displayName: nameMatch?.[1] || nameIdMatch?.[1] || emailMatch?.[1] || 'SAML User',
      groups,
      nameId: nameIdMatch?.[1] || emailMatch?.[1] || '',
    };
  } catch { return null; }
}

function deflateAndEncode(input: string): string {
  try {
    const { deflateSync } = require('zlib');
    return deflateSync(input).toString('base64');
  } catch {
    return Buffer.from(input).toString('base64');
  }
}
