export interface MerkleProof {
    leafIndex: number;
    leafHash: string;
    siblings: string[];
    root: string;
}
/** Build Merkle root from leaf hashes (hex strings). */
export declare function buildMerkleRoot(leaves: string[]): string;
export declare function leafHash(payload: string): string;
/** Generate inclusion proof for leaf at index. */
export declare function merkleProof(leaves: string[], leafIndex: number): MerkleProof | null;
export declare function verifyMerkleProof(proof: MerkleProof): boolean;
//# sourceMappingURL=merkle-tree.d.ts.map