import { createPrivateKey, createPublicKey, sign, verify } from 'crypto';

export type UnsignedEntitlement = {
  schema: 1;
  product: 'mastyf-guard-pro';
  license_id: string;
  instance_id: string;
  activation_id: string;
  model_repo: string;
  model_revision: string;
  gateway_version: string;
  key_id: string;
  issued_at: string;
  expires_at: string;
  grace_until: string;
};

export type SignedEntitlement = UnsignedEntitlement & {
  signature: string;
};

export const DEFAULT_KEY_ID = 'mastyf-2026-11';

/** Base64 raw 32-byte Ed25519 keys, from the environment only. */
function keyConfig(keyId: string): { privateKeyRawB64?: string; publicKeyRawB64?: string } | null {
  if (keyId !== DEFAULT_KEY_ID) return null;
  return {
    privateKeyRawB64: process.env.MASTYF_ED25519_PRIVATE_KEY?.trim() || undefined,
    publicKeyRawB64: process.env.MASTYF_ED25519_PUBLIC_KEY?.trim() || undefined,
  };
}

/**
 * Creates canonical string representation of unsigned entitlement fields
 * sorted alphabetically to ensure reproducible signatures.
 */
export function canonicalizeEntitlement(data: UnsignedEntitlement): string {
  const sortedKeys = Object.keys(data).sort() as (keyof UnsignedEntitlement)[];
  const obj: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    obj[k] = data[k];
  }
  return JSON.stringify(obj);
}

/**
 * Signs an entitlement payload with the server-side Ed25519 private key.
 * Private key is NEVER shared with or distributed to the client gateway.
 */
export function signEntitlement(
  unsigned: Omit<UnsignedEntitlement, 'key_id'>,
  keyId: string = DEFAULT_KEY_ID,
): SignedEntitlement {
  const config = keyConfig(keyId);
  if (!config?.privateKeyRawB64) {
    throw new Error(`Private key for key_id '${keyId}' is not available on this server`);
  }

  const unsignedWithKeyId: UnsignedEntitlement = {
    ...unsigned,
    key_id: keyId,
  };

  const canonicalString = canonicalizeEntitlement(unsignedWithKeyId);
  const data = Buffer.from(canonicalString, 'utf8');

  // Convert raw 32-byte private key into PKCS#8 DER for Node crypto
  const privRaw = Buffer.from(config.privateKeyRawB64, 'base64');
  const pkcs8Der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    privRaw,
  ]);

  const privateKey = createPrivateKey({
    key: pkcs8Der,
    format: 'der',
    type: 'pkcs8',
  });

  const sig = sign(null, data, privateKey);
  const signature = sig.toString('base64');

  return {
    ...unsignedWithKeyId,
    signature,
  };
}

/**
 * Verifies an Ed25519 signed entitlement token against the public key registry.
 */
export function verifyEntitlement(
  token: SignedEntitlement,
): { valid: boolean; reason?: string } {
  const { signature, ...unsigned } = token;
  const config = keyConfig(token.key_id);

  if (!config?.publicKeyRawB64) {
    return {
      valid: false,
      reason: `Unknown or untrusted key_id: '${token.key_id}'`,
    };
  }

  try {
    const canonicalString = canonicalizeEntitlement(unsigned as UnsignedEntitlement);
    const data = Buffer.from(canonicalString, 'utf8');
    const sigBytes = Buffer.from(signature, 'base64');

    // Convert raw 32-byte public key into SPKI DER for Node crypto
    const pubRaw = Buffer.from(config.publicKeyRawB64, 'base64');
    const spkiDer = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      pubRaw,
    ]);

    const publicKey = createPublicKey({
      key: spkiDer,
      format: 'der',
      type: 'spki',
    });

    const isVerified = verify(null, data, publicKey, sigBytes);
    if (!isVerified) {
      return { valid: false, reason: 'Cryptographic signature verification failed' };
    }

    return { valid: true };
  } catch (err: unknown) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
