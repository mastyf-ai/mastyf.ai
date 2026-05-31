/**
 * C1 — Binary Merkle tree for tamper-evident provenance checkpoints.
 */
import { createHash } from 'crypto';

export interface MerkleProof {
  leafIndex: number;
  leafHash: string;
  siblings: string[];
  root: string;
}

function hashPair(left: string, right: string): string {
  return createHash('sha256').update(`${left}${right}`).digest('hex');
}

/** Build Merkle root from leaf hashes (hex strings). */
export function buildMerkleRoot(leaves: string[]): string {
  if (!leaves.length) {
    return createHash('sha256').update('empty-merkle').digest('hex');
  }
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(hashPair(left, right));
    }
    level = next;
  }
  return level[0]!;
}

export function leafHash(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

/** Generate inclusion proof for leaf at index. */
export function merkleProof(leaves: string[], leafIndex: number): MerkleProof | null {
  if (leafIndex < 0 || leafIndex >= leaves.length) return null;
  const siblings: string[] = [];
  let level = [...leaves];
  let idx = leafIndex;

  while (level.length > 1) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    siblings.push(level[siblingIdx] ?? level[idx]!);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(hashPair(left, right));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }

  return {
    leafIndex,
    leafHash: leaves[leafIndex]!,
    siblings,
    root: level[0]!,
  };
}

export function verifyMerkleProof(proof: MerkleProof): boolean {
  let hash = proof.leafHash;
  let idx = proof.leafIndex;
  for (const sibling of proof.siblings) {
    hash = idx % 2 === 0 ? hashPair(hash, sibling) : hashPair(sibling, hash);
    idx = Math.floor(idx / 2);
  }
  return hash === proof.root;
}
