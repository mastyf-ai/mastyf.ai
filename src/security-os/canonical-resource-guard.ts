/**
 * Mastyf Tier 1A Canonical Resource Parsing & Pre-Dispatch Authorization Guard
 *
 * Implements:
 * 1. Canonical URI normalization (resolving traversal, encoding, null bytes, backslashes).
 * 2. Multi-attribute resource authorization (scheme, host, port, path containment, SSRF protection).
 * 3. Prompt parameter authorization and traversal defense for prompts/get.
 * 4. Pre-dispatch enforcement: fail closed before downstream MCP invocation.
 */

import * as path from 'path';

export interface CanonicalParsedResource {
  scheme: string;
  host?: string;
  port?: number;
  canonicalPath: string;
  query: Record<string, string>;
  resourceId: string;
  rawUri: string;
  hasTraversalAttempt: boolean;
  isDangerousPath: boolean;
  traversalReason?: string;
}

export interface AllowedDestinationConstraint {
  cidr?: string;
  hostname?: string;
  resolvedIps?: string[];
  ports?: number[];
  protocol?: string;
}

export interface ResourceAuthorizationContext {
  sessionId?: string;
  principal?: string;
  tenantId?: string;
  taintState?: string;
  allowedSchemes?: string[];
  allowedHosts?: string[];
  allowedPathPrefixes?: string[];
  prohibitedPathPrefixes?: string[];
  allowPrivateNetworks?: boolean;
  allowedDestinations?: AllowedDestinationConstraint[];
}

export interface ResourceAuthorizationResult {
  allowed: boolean;
  reason?: string;
  canonicalResource?: CanonicalParsedResource;
  code?: number;
}

export interface PromptAuthorizationResult {
  allowed: boolean;
  reason?: string;
  code?: number;
}

export type NetworkAddressClass =
  | 'LOOPBACK'
  | 'LINK_LOCAL_METADATA'
  | 'PRIVATE_RFC1918'
  | 'RESERVED_MULTICAST'
  | 'PUBLIC'
  | 'HOSTNAME';

export interface ResolvedDestinationInfo {
  rawHost: string;
  normalizedHost: string;
  addressClass: NetworkAddressClass;
  isNumericIp: boolean;
  numericIpv4?: number;
}

export function parseIpv4ToNumber(host: string): number | null {
  const clean = host.replace(/^\[|\]$/g, '').toLowerCase().trim();

  // Pure integer format (e.g. 2130706433 for 127.0.0.1)
  if (/^\d+$/.test(clean)) {
    const val = Number(clean);
    return val >= 0 && val <= 0xffffffff ? val >>> 0 : null;
  }

  // Hexadecimal format (e.g. 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(clean)) {
    const val = parseInt(clean, 16);
    return val >= 0 && val <= 0xffffffff ? val >>> 0 : null;
  }

  // Standard or mixed octal/hex dotted-quad (e.g. 127.0.0.1, 0177.0.0.1, 0x7f.0.0.1)
  const parts = clean.split('.');
  if (parts.length === 4) {
    let acc = 0;
    for (let i = 0; i < 4; i++) {
      const p = parts[i];
      let num: number;
      if (p.startsWith('0x') || p.startsWith('0X')) {
        num = parseInt(p, 16);
      } else if (p.startsWith('0') && p.length > 1 && !p.includes('8') && !p.includes('9')) {
        num = parseInt(p, 8);
      } else if (/^\d+$/.test(p)) {
        num = parseInt(p, 10);
      } else {
        return null;
      }
      if (isNaN(num) || num < 0 || num > 255) return null;
      acc = (acc << 8) | num;
    }
    return acc >>> 0;
  }
  return null;
}

export function matchesIpv4Cidr(ipNum: number, cidr: string): boolean {
  const [baseIp, maskBitsStr] = cidr.split('/');
  if (!baseIp || !maskBitsStr) return false;
  const baseNum = parseIpv4ToNumber(baseIp);
  const maskBits = parseInt(maskBitsStr, 10);
  if (baseNum === null || isNaN(maskBits) || maskBits < 0 || maskBits > 32) return false;
  if (maskBits === 0) return true;
  const mask = ((0xffffffff << (32 - maskBits)) >>> 0);
  return (ipNum & mask) === (baseNum & mask);
}

export function classifyNetworkHost(rawHost: string): ResolvedDestinationInfo {
  const clean = rawHost.replace(/^\[|\]$/g, '').toLowerCase().trim();

  // 1. Check IPv4 numeric / integer / hex representation
  const ipv4Num = parseIpv4ToNumber(clean);
  if (ipv4Num !== null) {
    const b0 = (ipv4Num >>> 24) & 0xff;
    const b1 = (ipv4Num >>> 16) & 0xff;

    // 127.0.0.0/8 or 0.0.0.0/8 -> Loopback / local
    if (b0 === 127 || b0 === 0) {
      return { rawHost, normalizedHost: clean, addressClass: 'LOOPBACK', isNumericIp: true, numericIpv4: ipv4Num };
    }
    // 169.254.0.0/16 -> Link-Local Cloud Metadata
    if (b0 === 169 && b1 === 254) {
      return { rawHost, normalizedHost: clean, addressClass: 'LINK_LOCAL_METADATA', isNumericIp: true, numericIpv4: ipv4Num };
    }
    // 10.0.0.0/8 -> Private RFC1918
    if (b0 === 10) {
      return { rawHost, normalizedHost: clean, addressClass: 'PRIVATE_RFC1918', isNumericIp: true, numericIpv4: ipv4Num };
    }
    // 172.16.0.0/12 -> Private RFC1918
    if (b0 === 172 && b1 >= 16 && b1 <= 31) {
      return { rawHost, normalizedHost: clean, addressClass: 'PRIVATE_RFC1918', isNumericIp: true, numericIpv4: ipv4Num };
    }
    // 192.168.0.0/16 -> Private RFC1918
    if (b0 === 192 && b1 === 168) {
      return { rawHost, normalizedHost: clean, addressClass: 'PRIVATE_RFC1918', isNumericIp: true, numericIpv4: ipv4Num };
    }
    // 224.0.0.0/4 (Multicast) or 240.0.0.0/4 (Reserved)
    if (b0 >= 224) {
      return { rawHost, normalizedHost: clean, addressClass: 'RESERVED_MULTICAST', isNumericIp: true, numericIpv4: ipv4Num };
    }
    return { rawHost, normalizedHost: clean, addressClass: 'PUBLIC', isNumericIp: true, numericIpv4: ipv4Num };
  }

  // 2. Check IPv6 representation
  if (clean === '::1' || clean === '0:0:0:0:0:0:0:1' || clean === '::') {
    return { rawHost, normalizedHost: clean, addressClass: 'LOOPBACK', isNumericIp: true };
  }
  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (clean.startsWith('::ffff:')) {
    const v4Part = clean.slice(7);
    const sub = classifyNetworkHost(v4Part);
    return { rawHost, normalizedHost: clean, addressClass: sub.addressClass, isNumericIp: true };
  }
  // IPv6 link-local (fe80::/10)
  if (/^fe[89ab][0-9a-f]:/i.test(clean) || clean.startsWith('fe80:')) {
    return { rawHost, normalizedHost: clean, addressClass: 'LINK_LOCAL_METADATA', isNumericIp: true };
  }
  // IPv6 Unique Local Address (fc00::/7) -> RFC1918 equivalent
  if (/^f[cd][0-9a-f]{2}:/i.test(clean)) {
    return { rawHost, normalizedHost: clean, addressClass: 'PRIVATE_RFC1918', isNumericIp: true };
  }

  // 3. Hostnames
  if (clean === 'localhost' || clean.endsWith('.localhost')) {
    return { rawHost, normalizedHost: clean, addressClass: 'LOOPBACK', isNumericIp: false };
  }
  if (
    clean === '169.254.169.254' ||
    clean === 'instance-data' ||
    clean.includes('metadata.google') ||
    clean.includes('metadata.aws')
  ) {
    return { rawHost, normalizedHost: clean, addressClass: 'LINK_LOCAL_METADATA', isNumericIp: false };
  }

  return { rawHost, normalizedHost: clean, addressClass: 'HOSTNAME', isNumericIp: false };
}

// Prohibited sensitive system paths (UNIX and Windows)
const PROHIBITED_SYSTEM_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/master.passwd',
  '/proc',
  '/sys',
  '/dev',
  '/var/run',
  '/root',
  '/.ssh',
  '/id_rsa',
  '/.env',
  'c:\\windows',
  'c:\\winnt',
  '\\system32',
  '\\sam',
];

const DEFAULT_ALLOWED_SCHEMES = new Set([
  'file',
  'postgres',
  'postgresql',
  'mysql',
  's3',
  'https',
  'http',
  'mcp',
  'internal',
  'custom',
]);

/**
 * Normalizes and canonically parses a raw resource URI.
 * Guarantees traversal resolution and flags path escapes.
 */
export function parseCanonicalResource(rawUri: string): CanonicalParsedResource {
  if (typeof rawUri !== 'string' || !rawUri.trim()) {
    return {
      scheme: 'invalid',
      canonicalPath: '',
      query: {},
      resourceId: '',
      rawUri: String(rawUri),
      hasTraversalAttempt: true,
      isDangerousPath: true,
      traversalReason: 'Empty or non-string resource URI',
    };
  }

  const trimmed = rawUri.trim();

  // Check for null byte injections
  if (trimmed.includes('\0') || trimmed.includes('%00')) {
    return {
      scheme: 'invalid',
      canonicalPath: '',
      query: {},
      resourceId: trimmed,
      rawUri: trimmed,
      hasTraversalAttempt: true,
      isDangerousPath: true,
      traversalReason: 'Null byte injection detected in URI',
    };
  }

  // Double URI decoding to catch %252e%252e obfuscations
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
    if (decoded.includes('%')) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        // Ignored, proceed with single decode
      }
    }
  } catch {
    // Malformed URI encoding
    return {
      scheme: 'invalid',
      canonicalPath: '',
      query: {},
      resourceId: trimmed,
      rawUri: trimmed,
      hasTraversalAttempt: true,
      isDangerousPath: true,
      traversalReason: 'Malformed URI encoding',
    };
  }

  // Traversal pattern inspection
  const hasTraversalAttempt =
    decoded.includes('..') ||
    trimmed.includes('%2e%2e') ||
    trimmed.includes('%2E%2E') ||
    trimmed.includes('..%2f') ||
    trimmed.includes('..%5c') ||
    decoded.includes('/../') ||
    decoded.endsWith('/..') ||
    decoded.startsWith('../') ||
    decoded.includes('\\..\\');

  // Scheme extraction
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(decoded);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : 'file';
  const restAfterScheme = schemeMatch ? decoded.slice(schemeMatch[0].length) : decoded;

  let host: string | undefined;
  let port: number | undefined;
  let rawPath = restAfterScheme;
  // Null prototype: a query key is attacker-controlled, and on a plain object
  // literal a "__proto__" key would hit the inherited setter rather than
  // creating an own property. The object is only ever read via Object.keys and
  // computed reads, both of which behave identically without a prototype.
  const query = Object.create(null) as Record<string, string>;

  // Extract query string if present
  const queryIdx = rawPath.indexOf('?');
  if (queryIdx !== -1) {
    const qStr = rawPath.slice(queryIdx + 1);
    rawPath = rawPath.slice(0, queryIdx);
    const pairs = qStr.split('&');
    for (const pair of pairs) {
      if (!pair) continue;
      const [k, v] = pair.split('=');
      // codeql[js/remote-property-injection] The query key is attacker
      // controlled, but `query` is created with a null prototype above, so a
      // "__proto__" key becomes an own property and cannot reach Object.prototype
      // or any setter. The map never escapes as a shared object: it is read only
      // via Object.keys and computed reads, and callers receive it as data.
      if (k) query[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    }
  }

  // Handle authority if URI starts with //
  if (rawPath.startsWith('//')) {
    const slashIdx = rawPath.indexOf('/', 2);
    const authority = slashIdx !== -1 ? rawPath.slice(2, slashIdx) : rawPath.slice(2);
    rawPath = slashIdx !== -1 ? rawPath.slice(slashIdx) : '/';

    if (authority.startsWith('[')) {
      const closingBracket = authority.indexOf(']');
      if (closingBracket !== -1) {
        host = authority.slice(1, closingBracket).toLowerCase();
        const afterBracket = authority.slice(closingBracket + 1);
        if (afterBracket.startsWith(':')) {
          const p = parseInt(afterBracket.slice(1), 10);
          if (!isNaN(p) && p > 0 && p <= 65535) port = p;
        }
      } else {
        host = authority.toLowerCase();
      }
    } else {
      const colonIdx = authority.indexOf(':');
      if (colonIdx !== -1) {
        host = authority.slice(0, colonIdx).toLowerCase();
        const p = parseInt(authority.slice(colonIdx + 1), 10);
        if (!isNaN(p) && p > 0 && p <= 65535) port = p;
      } else {
        host = authority.toLowerCase();
      }
    }
  }

  // Normalize path
  // Standardize backslashes to forward slashes
  let normalizedPath = rawPath.replace(/\\/g, '/');
  // Collapse duplicate slashes
  normalizedPath = normalizedPath.replace(/\/+/g, '/');
  if (!normalizedPath.startsWith('/')) {
    normalizedPath = '/' + normalizedPath;
  }

  // Path resolution check (using POSIX path.normalize)
  const resolved = path.posix.normalize(normalizedPath);
  let traversalReason: string | undefined;
  let traversalDetected = hasTraversalAttempt;

  if (resolved.includes('..') || resolved.startsWith('/../')) {
    traversalDetected = true;
    traversalReason = 'Path escapes root via directory traversal sequence';
  } else if (hasTraversalAttempt) {
    traversalReason = 'URI contains prohibited relative traversal components';
  }

  // Sensitive system path check
  const lowerResolved = resolved.toLowerCase();
  let isDangerousPath = false;
  for (const sysPath of PROHIBITED_SYSTEM_PATHS) {
    if (lowerResolved === sysPath || lowerResolved.startsWith(sysPath + '/') || lowerResolved.includes(sysPath)) {
      isDangerousPath = true;
      break;
    }
  }

  // Stable canonical resource identifier
  const hostPart = host ? `//${host}${port ? `:${port}` : ''}` : '';
  const queryKeys = Object.keys(query).sort();
  const queryPart = queryKeys.length > 0 ? '?' + queryKeys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&') : '';
  const resourceId = `${scheme}:${hostPart}${resolved}${queryPart}`;

  return {
    scheme,
    host,
    port,
    canonicalPath: resolved,
    query,
    resourceId,
    rawUri: trimmed,
    hasTraversalAttempt: traversalDetected,
    isDangerousPath,
    traversalReason,
  };
}

/**
 * Pre-dispatch authorization evaluator for Tier 1A sensitive read operations.
 * Evaluates canonical resource against path traversal, sensitive system boundaries,
 * SSRF blocklists, and tenant/session constraints.
 */
export function authorizeResourceRead(
  rawUri: string,
  context: ResourceAuthorizationContext = {},
): ResourceAuthorizationResult {
  const parsed = parseCanonicalResource(rawUri);

  // 1. Traversal denial
  if (parsed.hasTraversalAttempt) {
    return {
      allowed: false,
      code: -32001,
      reason: `Resource Access Denied: ${parsed.traversalReason ?? 'Directory traversal attempt detected'}`,
      canonicalResource: parsed,
    };
  }

  // 2. Sensitive system file denial
  if (parsed.isDangerousPath) {
    return {
      allowed: false,
      code: -32001,
      reason: `Resource Access Denied: Target '${parsed.canonicalPath}' matches prohibited sensitive system path`,
      canonicalResource: parsed,
    };
  }

  // 3. Scheme validation
  const allowedSchemes = context.allowedSchemes ? new Set(context.allowedSchemes.map((s) => s.toLowerCase())) : DEFAULT_ALLOWED_SCHEMES;
  if (!allowedSchemes.has(parsed.scheme)) {
    return {
      allowed: false,
      code: -32001,
      reason: `Resource Access Denied: Unauthorized URI scheme '${parsed.scheme}'`,
      canonicalResource: parsed,
    };
  }

  // 4. Normalized destination capability evaluation & SSRF confinement
  if (parsed.host) {
    const dest = classifyNetworkHost(parsed.host);
    if (dest.addressClass === 'LOOPBACK') {
      return {
        allowed: false,
        code: -32001,
        reason: `Resource Access Denied: SSRF protection blocked connection to loopback address '${parsed.host}'`,
        canonicalResource: parsed,
      };
    }
    if (dest.addressClass === 'LINK_LOCAL_METADATA') {
      return {
        allowed: false,
        code: -32001,
        reason: `Resource Access Denied: SSRF protection blocked connection to cloud metadata service '${parsed.host}'`,
        canonicalResource: parsed,
      };
    }
    if (dest.addressClass === 'RESERVED_MULTICAST') {
      return {
        allowed: false,
        code: -32001,
        reason: `Resource Access Denied: Target '${parsed.host}' is in reserved or multicast address space`,
        canonicalResource: parsed,
      };
    }
    if (dest.addressClass === 'PRIVATE_RFC1918') {
      let permittedByCapability = false;

      // 1. Check narrow allowedDestinations constraints (CIDR, hostname, resolved IPs, port)
      if (context.allowedDestinations && context.allowedDestinations.length > 0) {
        for (const constraint of context.allowedDestinations) {
          // Port check (if constraint specifies port)
          if (constraint.ports && constraint.ports.length > 0) {
            if (!parsed.port || !constraint.ports.includes(parsed.port)) {
              continue;
            }
          }
          // CIDR check for IPv4
          if (constraint.cidr && dest.numericIpv4 !== undefined) {
            if (matchesIpv4Cidr(dest.numericIpv4, constraint.cidr)) {
              permittedByCapability = true;
              break;
            }
          }
          // Hostname check
          if (constraint.hostname && dest.normalizedHost === constraint.hostname.toLowerCase()) {
            permittedByCapability = true;
            break;
          }
          // Explicit resolved IPs check
          if (constraint.resolvedIps && dest.numericIpv4 !== undefined) {
            const matchesResolved = constraint.resolvedIps.some((rip) => {
              const rNum = parseIpv4ToNumber(rip);
              return rNum !== null && rNum === dest.numericIpv4;
            });
            if (matchesResolved) {
              permittedByCapability = true;
              break;
            }
          }
        }
      }

      // 2. Scoped fallback: allowPrivateNetworks
      if (!permittedByCapability && context.allowPrivateNetworks) {
        permittedByCapability = true;
      }

      if (!permittedByCapability) {
        return {
          allowed: false,
          code: -32001,
          reason: `Resource Access Denied: Target '${parsed.host}' is in private RFC1918 space (requires matching allowedDestinations CIDR/constraint or scoped private network capability)`,
          canonicalResource: parsed,
        };
      }
    }
  }

  // 5. Allowed path prefixes check (if configured)
  if (context.allowedPathPrefixes && context.allowedPathPrefixes.length > 0) {
    const isUnderAllowedPrefix = context.allowedPathPrefixes.some((prefix) => {
      const normPrefix = path.posix.normalize(prefix);
      return parsed.canonicalPath === normPrefix || parsed.canonicalPath.startsWith(normPrefix.endsWith('/') ? normPrefix : normPrefix + '/');
    });
    if (!isUnderAllowedPrefix) {
      return {
        allowed: false,
        code: -32001,
        reason: `Resource Access Denied: Resource path '${parsed.canonicalPath}' is not within authorized directory boundaries`,
        canonicalResource: parsed,
      };
    }
  }

  // 6. Prohibited path prefixes
  if (context.prohibitedPathPrefixes && context.prohibitedPathPrefixes.length > 0) {
    for (const prefix of context.prohibitedPathPrefixes) {
      const normPrefix = path.posix.normalize(prefix);
      if (parsed.canonicalPath === normPrefix || parsed.canonicalPath.startsWith(normPrefix.endsWith('/') ? normPrefix : normPrefix + '/')) {
        return {
          allowed: false,
          code: -32001,
          reason: `Resource Access Denied: Resource path '${parsed.canonicalPath}' matches prohibited prefix '${prefix}'`,
          canonicalResource: parsed,
        };
      }
    }
  }

  return {
    allowed: true,
    canonicalResource: parsed,
  };
}

/**
 * Pre-dispatch authorization evaluator for Tier 1A prompts/get operations.
 */
export function authorizePromptGet(
  promptName: unknown,
  args?: unknown,
  _context: ResourceAuthorizationContext = {},
): PromptAuthorizationResult {
  if (typeof promptName !== 'string' || !promptName.trim()) {
    return {
      allowed: false,
      code: -32602,
      reason: 'Invalid params: prompt name must be a non-empty string',
    };
  }

  const name = promptName.trim();

  // Traversal or injection characters in prompt name
  if (
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.includes('%00')
  ) {
    return {
      allowed: false,
      code: -32001,
      reason: `Prompt Access Denied: Invalid prompt identifier '${name}' containing traversal or control characters`,
    };
  }

  // Identifier pattern check
  if (!/^[a-zA-Z0-9_\-.:]+$/.test(name)) {
    return {
      allowed: false,
      code: -32001,
      reason: `Prompt Access Denied: Prompt identifier '${name}' contains forbidden characters`,
    };
  }

  return {
    allowed: true,
  };
}
