export type VerifiedState = 'VERIFIED' | 'DECLARED' | 'CHANGED' | 'UNKNOWN' | 'ABSENT' | 'UNAVAILABLE' | 'FAILED';
export interface VerifiedProfileStates {
    identity: VerifiedState;
    integrity: VerifiedState;
    capabilities: VerifiedState;
    egress: VerifiedState;
    audit: VerifiedState;
}
export interface MastyfVerifiedManifest {
    schema: 1;
    kind: 'mastyf_verified';
    package_id: string;
    package_version: string;
    publisher: string;
    issued_at: string;
    expires_at?: string;
    /** Capability classes declared by publisher — not a score. */
    capabilities: string[];
    /** Declared egress destinations (hosts/URLs); empty = none declared. */
    egress: string[];
    /** Content digest (sha256 hex) of the package/server pin material. */
    integrity_digest: string;
    /** Audit artifact refs (receipt hashes, attestation URIs) — may be empty. */
    audit_refs: string[];
    key_id: string;
    signature?: string;
}
export interface VerifiedCheckResult {
    /** Overall machine status — never a numeric score. */
    status: 'VERIFIED' | 'FAILED' | 'UNAVAILABLE' | 'EXPIRED' | 'UNSIGNED';
    states: VerifiedProfileStates;
    reason: string;
    manifest?: MastyfVerifiedManifest;
}
export declare function hasVerifiedSigningKey(keyId?: string): boolean;
export declare function signVerifiedManifest(unsigned: Omit<MastyfVerifiedManifest, 'signature'>): MastyfVerifiedManifest;
export declare function verifyVerifiedManifest(manifest: MastyfVerifiedManifest | null | undefined): VerifiedCheckResult;
export declare function digestPinMaterial(material: string | Buffer): string;
//# sourceMappingURL=verified-manifest.d.ts.map