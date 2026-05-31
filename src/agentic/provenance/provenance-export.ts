/**
 * Signed provenance bundle export (gzip JSON + HMAC attestation) for auditors/SIEM.
 */
import { createHmac, createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import type { ConfigProvenanceEvent } from './config-provenance-chain.js';
import { getCertSigningKey } from '../certification/cert-signing.js';

export interface SignedProvenanceBundle {
  version: '1.0';
  merkleRoot: string;
  eventCount: number;
  exportedAt: string;
  bundleGzipBase64: string;
  bundleSha256: string;
  signature: string;
  eventsPreview: Array<Pick<ConfigProvenanceEvent, 'eventId' | 'eventType' | 'actor' | 'createdAt'>>;
}

export function exportSignedProvenanceBundle(
  events: ConfigProvenanceEvent[],
  merkleRoot: string,
): SignedProvenanceBundle {
  const payload = JSON.stringify({
    version: '1.0',
    merkleRoot,
    eventCount: events.length,
    exportedAt: new Date().toISOString(),
    events,
  });
  const compressed = gzipSync(Buffer.from(payload, 'utf-8'));
  const bundleSha256 = createHash('sha256').update(compressed).digest('hex');
  const signature = createHmac('sha256', getCertSigningKey())
    .update(`${merkleRoot}\n${bundleSha256}`)
    .digest('hex');

  return {
    version: '1.0',
    merkleRoot,
    eventCount: events.length,
    exportedAt: new Date().toISOString(),
    bundleGzipBase64: compressed.toString('base64'),
    bundleSha256,
    signature,
    eventsPreview: events.slice(-20).map(e => ({
      eventId: e.eventId,
      eventType: e.eventType,
      actor: e.actor,
      createdAt: e.createdAt,
    })),
  };
}

export function verifySignedProvenanceBundle(bundle: SignedProvenanceBundle): boolean {
  const compressed = Buffer.from(bundle.bundleGzipBase64, 'base64');
  const bundleSha256 = createHash('sha256').update(compressed).digest('hex');
  if (bundleSha256 !== bundle.bundleSha256) return false;
  const expected = createHmac('sha256', getCertSigningKey())
    .update(`${bundle.merkleRoot}\n${bundleSha256}`)
    .digest('hex');
  return expected === bundle.signature;
}

/** Build a minimal ustar tar archive (no external deps). */
function buildUstarTar(files: Array<{ name: string; data: Buffer }>): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512, 0);
    const name = file.name.slice(0, 100);
    header.write(name, 0, 'utf-8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(file.data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i]!;
    header.write(String(checksum) + '\0 ', 148, 8, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    blocks.push(header);
    blocks.push(file.data);
    const pad = (512 - (file.data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(512));
  blocks.push(Buffer.alloc(512));
  return Buffer.concat(blocks);
}

export function writeSignedProvenanceTarball(
  events: ConfigProvenanceEvent[],
  merkleRoot: string,
  outputPath: string,
): { path: string; bundle: SignedProvenanceBundle; tarballBytes: number } {
  const bundle = exportSignedProvenanceBundle(events, merkleRoot);
  const manifest = Buffer.from(JSON.stringify({
    version: bundle.version,
    merkleRoot: bundle.merkleRoot,
    eventCount: bundle.eventCount,
    exportedAt: bundle.exportedAt,
    bundleSha256: bundle.bundleSha256,
    signature: bundle.signature,
  }, null, 2));
  const eventsJson = Buffer.from(JSON.stringify(events, null, 2));
  const bundleGz = Buffer.from(bundle.bundleGzipBase64, 'base64');
  const tar = buildUstarTar([
    { name: 'manifest.json', data: manifest },
    { name: 'events.json', data: eventsJson },
    { name: 'bundle.json.gz', data: bundleGz },
  ]);
  const tarball = gzipSync(tar);
  const dir = outputPath.includes('/') ? outputPath.replace(/\/[^/]+$/, '') : '.';
  if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, tarball);
  return { path: outputPath, bundle, tarballBytes: tarball.length };
}
