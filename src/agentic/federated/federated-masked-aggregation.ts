/**
 * B3 — Pairwise-masked gradient aggregation (MPC-lite secure FedAvg analog).
 * Masks cancel when all participant gradients are summed; server never sees raw local gradients.
 */
import { createHmac } from 'crypto';

function maskVector(participantId: string, peerId: string, roundId: string, dim: number, sign: 1 | -1): number[] {
  const hmac = createHmac('sha256', process.env.GUARDIAN_FEDERATED_MPC_SECRET ?? 'guardian-federated-mpc')
    .update(`${roundId}:${participantId}:${peerId}`)
    .digest();
  const out = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    const b = hmac[i % hmac.length]!;
    out[i] = sign * ((b / 127.5) - 1) * 0.01;
  }
  return out;
}

/** Mask a local gradient before upload to aggregator. */
export function maskGradientForUpload(
  gradient: number[],
  participantId: string,
  peerIds: string[],
  roundId: string,
): number[] {
  const dim = gradient.length;
  const masked = [...gradient];
  for (const peerId of peerIds) {
    if (peerId === participantId) continue;
    const lo = participantId < peerId ? participantId : peerId;
    const hi = participantId < peerId ? peerId : participantId;
    const sign: 1 | -1 = participantId === lo ? 1 : -1;
    const m = maskVector(lo, hi, roundId, dim, sign);
    for (let i = 0; i < dim; i++) masked[i]! += m[i]!;
  }
  return masked;
}

/** Unmask aggregated sum — pairwise masks cancel when all parties contributed. */
export function unmaskAggregatedGradients(
  summedMasked: number[],
  participantIds: string[],
  roundId: string,
): number[] {
  // Masks already canceled in sum when full participant set present.
  void participantIds;
  void roundId;
  return summedMasked;
}

export function sumMaskedGradients(masked: number[][]): number[] {
  if (!masked.length) return [];
  const dim = Math.max(...masked.map(m => m.length));
  const acc = new Array(dim).fill(0);
  for (const row of masked) {
    for (let i = 0; i < row.length; i++) acc[i] += row[i]!;
  }
  return acc;
}
