/** The same secret scrub, for text that is already a snippet. */
export declare function redactSecretsInText(value: string): string;
/** Store a privacy-safe snapshot suitable for replay and compliance evidence. */
export declare function snapshotAuditArguments(args?: Record<string, unknown>): Record<string, unknown> | undefined;
export declare function argsFingerprint(args?: Record<string, unknown>): string;
//# sourceMappingURL=audit-args-snapshot.d.ts.map