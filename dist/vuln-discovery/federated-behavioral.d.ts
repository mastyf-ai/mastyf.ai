export interface BehavioralFingerprintHint {
    toolName: string;
    score: number;
    serverHash: string;
    at?: string;
}
/** Persist anonymized fingerprint locally; optionally sync via fleetsignature exchange. */
export declare function shareBehavioralFingerprint(hint: BehavioralFingerprintHint): void;
export declare function loadRecentBehavioralHints(limit?: number): BehavioralFingerprintHint[];
//# sourceMappingURL=federated-behavioral.d.ts.map