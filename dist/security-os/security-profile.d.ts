import { z } from 'zod';
export declare const SECURITY_PROFILE_KIND: "mastyf_security_profile";
export declare const SECURITY_PROFILE_VERSION: "1";
declare const FleetAuthoritySchema: z.ZodObject<{
    install_roles: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    approve_roles: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    allowed_servers: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    allowed_tools: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    allowed_data_labels: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    allowed_destinations: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    install_roles: string[];
    approve_roles: string[];
    allowed_servers: string[];
    allowed_tools: string[];
    allowed_data_labels: string[];
    allowed_destinations: string[];
}, {
    install_roles?: string[] | undefined;
    approve_roles?: string[] | undefined;
    allowed_servers?: string[] | undefined;
    allowed_tools?: string[] | undefined;
    allowed_data_labels?: string[] | undefined;
    allowed_destinations?: string[] | undefined;
}>;
export declare const SecurityProfileSchema: z.ZodObject<{
    version: z.ZodUnion<[z.ZodLiteral<"1">, z.ZodLiteral<"1">]>;
    kind: z.ZodLiteral<"mastyf_security_profile">;
    identity: z.ZodObject<{
        org_id: z.ZodString;
        profile_id: z.ZodString;
        display_name: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        org_id: string;
        profile_id: string;
        display_name?: string | undefined;
    }, {
        org_id: string;
        profile_id: string;
        display_name?: string | undefined;
    }>;
    authority: z.ZodDefault<z.ZodObject<{
        install_roles: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        approve_roles: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        allowed_servers: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        allowed_tools: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        allowed_data_labels: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        allowed_destinations: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        install_roles: string[];
        approve_roles: string[];
        allowed_servers: string[];
        allowed_tools: string[];
        allowed_data_labels: string[];
        allowed_destinations: string[];
    }, {
        install_roles?: string[] | undefined;
        approve_roles?: string[] | undefined;
        allowed_servers?: string[] | undefined;
        allowed_tools?: string[] | undefined;
        allowed_data_labels?: string[] | undefined;
        allowed_destinations?: string[] | undefined;
    }>>;
    mediation: z.ZodDefault<z.ZodObject<{
        certified_only: z.ZodDefault<z.ZodBoolean>;
        fail_closed: z.ZodDefault<z.ZodBoolean>;
        require_signed_verified: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        certified_only: boolean;
        fail_closed: boolean;
        require_signed_verified: boolean;
    }, {
        certified_only?: boolean | undefined;
        fail_closed?: boolean | undefined;
        require_signed_verified?: boolean | undefined;
    }>>;
    threat_intel: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        /** Third-party feed URL — labeled external; fail-closed when unavailable. */
        feed_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        source_label: z.ZodDefault<z.ZodLiteral<"third-party">>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        source_label: "third-party";
        feed_url?: string | null | undefined;
    }, {
        enabled?: boolean | undefined;
        feed_url?: string | null | undefined;
        source_label?: "third-party" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    version: "1";
    identity: {
        org_id: string;
        profile_id: string;
        display_name?: string | undefined;
    };
    kind: "mastyf_security_profile";
    threat_intel: {
        enabled: boolean;
        source_label: "third-party";
        feed_url?: string | null | undefined;
    };
    authority: {
        install_roles: string[];
        approve_roles: string[];
        allowed_servers: string[];
        allowed_tools: string[];
        allowed_data_labels: string[];
        allowed_destinations: string[];
    };
    mediation: {
        certified_only: boolean;
        fail_closed: boolean;
        require_signed_verified: boolean;
    };
}, {
    version: "1";
    identity: {
        org_id: string;
        profile_id: string;
        display_name?: string | undefined;
    };
    kind: "mastyf_security_profile";
    threat_intel?: {
        enabled?: boolean | undefined;
        feed_url?: string | null | undefined;
        source_label?: "third-party" | undefined;
    } | undefined;
    authority?: {
        install_roles?: string[] | undefined;
        approve_roles?: string[] | undefined;
        allowed_servers?: string[] | undefined;
        allowed_tools?: string[] | undefined;
        allowed_data_labels?: string[] | undefined;
        allowed_destinations?: string[] | undefined;
    } | undefined;
    mediation?: {
        certified_only?: boolean | undefined;
        fail_closed?: boolean | undefined;
        require_signed_verified?: boolean | undefined;
    } | undefined;
}>;
export type SecurityProfile = z.infer<typeof SecurityProfileSchema>;
export type FleetAuthority = z.infer<typeof FleetAuthoritySchema>;
export interface SecurityProfileLoadResult {
    status: 'LOADED' | 'ABSENT' | 'INVALID';
    profile: SecurityProfile | null;
    path: string | null;
    reason?: string;
}
export declare function resolveSecurityProfilePath(explicit?: string | null): string | null;
export declare function parseSecurityProfile(raw: unknown): SecurityProfile;
export declare function loadSecurityProfile(explicitPath?: string | null): SecurityProfileLoadResult;
/** Protect-time gate: when profile LOADED + certified_only, require allowlisted servers. */
export declare function assertServersAllowedByProfile(profile: SecurityProfile, serverNames: string[]): {
    ok: boolean;
    blocked: string[];
    reason?: string;
};
export {};
//# sourceMappingURL=security-profile.d.ts.map