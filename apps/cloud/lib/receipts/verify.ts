/**
 * Checks Mastyf Shield block receipts (format v1) with the Web Crypto API, so the same code runs in
 * the browser and in Node. The signature covers the canonical JSON (keys sorted at every level, no
 * whitespace) of every field except `signature`; `prev_receipt_sha256` is the SHA-256 of the previous
 * receipt's canonical JSON, signature included.
 */

export type BlockReceipt = {
  type: 'mastyf.block-receipt';
  version: 1;
  receipt_id: string;
  issued_at: string;
  agent: string;
  tool: string;
  arguments_sha256: string;
  arguments_preview: string;
  decision: 'block';
  layer: 'policy' | 'protocol-x' | 'difc' | 'aia' | 'causal-gate';
  rule: string | null;
  reason: string;
  policy_sha256: string | null;
  shield_version: string;
  prev_receipt_sha256: string | null;
  signature: { alg: 'Ed25519'; key_id: string; public_key: string; value: string };
};

export type Verdict = { ok: true } | { ok: false; why: string };

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The key id Shield prints: the first 16 hex characters of SHA-256 over the raw public key. */
async function keyIdOf(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export async function verifyReceipt(receipt: BlockReceipt): Promise<Verdict> {
  try {
    if (receipt.type !== 'mastyf.block-receipt' || receipt.version !== 1) return { ok: false, why: 'not a v1 receipt' };
    const { signature, ...body } = receipt;
    if (signature?.alg !== 'Ed25519') return { ok: false, why: 'unknown signature type' };
    const raw = fromBase64(signature.public_key);
    if (raw.length !== 32) return { ok: false, why: 'bad public key' };
    if ((await keyIdOf(raw)) !== signature.key_id) return { ok: false, why: 'key id does not match the key' };
    const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    const good = await crypto.subtle.verify({ name: 'Ed25519' }, key, fromBase64(signature.value), utf8(canonicalJson(body)));
    return good ? { ok: true } : { ok: false, why: 'signature does not match the contents' };
  } catch {
    return { ok: false, why: 'could not be checked' };
  }
}

/** Every receipt verifies, and each one points at the one before it. */
export async function verifyChain(receipts: BlockReceipt[]): Promise<Verdict> {
  let prev: string | null = null;
  for (const [i, r] of receipts.entries()) {
    const one = await verifyReceipt(r);
    if (!one.ok) return { ok: false, why: `receipt ${i + 1}: ${one.why}` };
    if (i > 0 && r.prev_receipt_sha256 !== prev) return { ok: false, why: `receipt ${i + 1} does not follow receipt ${i}` };
    prev = await sha256Hex(canonicalJson(r));
  }
  return { ok: true };
}
