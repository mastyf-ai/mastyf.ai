export declare function isVulnDiscoveryEnabled(): boolean;
export declare function getAllowlist(): string[];
export declare function getDenylist(): string[];
/**
 * Returns true if the URL/host is authorized for active vuln probing.
 * Default deny: private RFC1918 / localhost / metadata unless allowlisted.
 */
export declare function isTargetAuthorized(urlOrHost: string): {
    ok: boolean;
    reason: string;
};
export declare function checkProbeRateLimit(): {
    ok: boolean;
    reason: string;
};
export declare function auditProbe(event: {
    action: string;
    target: string;
    authorized: boolean;
    detail?: string;
}): void;
//# sourceMappingURL=auth.d.ts.map