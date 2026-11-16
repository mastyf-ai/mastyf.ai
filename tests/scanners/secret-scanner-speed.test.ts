import { describe, expect, it } from 'vitest';
import { scanForSecrets } from '../../src/scanners/secret-scanner.js';

/** Deterministic pseudo-random characters, so samples look like real tokens without being any. */
function randomChars(n: number, alphabet: string, seed = 7): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += alphabet[(x >>> 16) % alphabet.length]; // the high bits vary; the low bits of this generator repeat
  }
  return out;
}
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const B64 = `${ALNUM}+/`;

/** Text shaped like minified JavaScript: short identifiers, operators and punctuation, no secret keywords. */
function minifiedCode(bytes: number): string {
  const parts: string[] = [];
  let size = 0;
  let i = 0;
  while (size < bytes) {
    const piece = `var ${randomChars(3, 'abcdefghij', i)}=${randomChars(6, ALNUM, i + 1)};function ${randomChars(2, 'klmnop', i + 2)}(e,t){return e+t*${i % 97}};`;
    parts.push(piece);
    size += piece.length;
    i++;
  }
  return parts.join('');
}

describe('secret scanner: time grows with the text, not its square', () => {
  it('1 MB of one repeated character: under 2 s and nothing found', () => {
    const t = Date.now();
    const found = scanForSecrets('a'.repeat(1024 * 1024), 'response');
    expect(Date.now() - t).toBeLessThan(2000);
    expect(found).toEqual([]);
  });

  it('512 KB of minified-code-like text: under 3 s', () => {
    const text = minifiedCode(512 * 1024);
    const t = Date.now();
    scanForSecrets(text, 'response');
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

describe('secret scanner: still finds real secrets', () => {
  it('keyword-gated rules (Okta, Cohere)', () => {
    const okta = `okta_token = "00${randomChars(40, ALNUM, 11)}"`;
    const cohere = `cohere_api_key = "${randomChars(40, ALNUM, 13)}"`;
    expect(scanForSecrets(okta, 'x').map((f) => f.type)).toContain('okta-access-token');
    expect(scanForSecrets(cohere, 'x').map((f) => f.type)).toContain('cohere-api-token');
  });

  it('credentials in a URI', () => {
    const uri = ['postgres://', 'admin', ':', `S${randomChars(14, ALNUM, 17)}`, '@db.internal.corp:5432/app'].join('');
    const types = scanForSecrets(uri, 'x').map((f) => f.type);
    expect(types.some((t) => t === 'uri-credentials' || t === 'postgres-url')).toBe(true);
    // A non-database scheme only the generic rule covers.
    const generic = ['smtp://', 'mailer', ':', `S${randomChars(14, ALNUM, 23)}`, '@mail.acme-corp.com:587'].join('');
    expect(scanForSecrets(generic, 'x').map((f) => f.type)).toContain('uri-credentials');
  });

  it('a large base64 blob is flagged, a long run of one character is not', () => {
    expect(scanForSecrets(` ${randomChars(200, B64, 19)} `, 'x').map((f) => f.type)).toContain('base64_large');
    expect(scanForSecrets(` ${'a'.repeat(200)} `, 'x').map((f) => f.type)).not.toContain('base64_large');
  });
});
