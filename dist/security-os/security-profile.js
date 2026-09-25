/**
 * Portable mastyf_security_profile / mcp-security.yaml
 * Consumed at protect time (TS loader + gateway Python twin).
 * Honesty: missing profile → null / UNAVAILABLE — never invent authority.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { z } from 'zod';
export const SECURITY_PROFILE_KIND = 'mastyf_security_profile';
export const SECURITY_PROFILE_VERSION = '1';
const FleetAuthoritySchema = z.object({
    install_roles: z.array(z.string().min(1)).default(['admin', 'security']),
    approve_roles: z.array(z.string().min(1)).default(['admin', 'security']),
    allowed_servers: z.array(z.string()).default([]),
    allowed_tools: z.array(z.string()).default([]),
    allowed_data_labels: z.array(z.string()).default([]),
    allowed_destinations: z.array(z.string()).default([]),
});
const MediationSchema = z.object({
    certified_only: z.boolean().default(false),
    fail_closed: z.boolean().default(true),
    require_signed_verified: z.boolean().default(false),
});
const ThreatIntelSchema = z.object({
    enabled: z.boolean().default(false),
    /** Third-party feed URL — labeled external; fail-closed when unavailable. */
    feed_url: z.string().url().nullable().optional(),
    source_label: z.literal('third-party').default('third-party'),
});
export const SecurityProfileSchema = z.object({
    version: z.literal(SECURITY_PROFILE_VERSION).or(z.literal('1')),
    kind: z.literal(SECURITY_PROFILE_KIND),
    identity: z.object({
        org_id: z.string().min(1),
        profile_id: z.string().min(1),
        display_name: z.string().optional(),
    }),
    authority: FleetAuthoritySchema.default({}),
    mediation: MediationSchema.default({}),
    threat_intel: ThreatIntelSchema.default({}),
});
const CANDIDATE_NAMES = [
    'mcp-security.yaml',
    'mcp-security.yml',
    'mastyf_security_profile.yaml',
    'mastyf_security_profile.yml',
];
export function resolveSecurityProfilePath(explicit) {
    if (explicit && existsSync(explicit))
        return explicit;
    const envPath = process.env['MASTYF_SECURITY_PROFILE'] || process.env['MASTYF_AI_SECURITY_PROFILE'];
    if (envPath && existsSync(envPath))
        return envPath;
    const cwd = process.cwd();
    for (const name of CANDIDATE_NAMES) {
        const p = join(cwd, name);
        if (existsSync(p))
            return p;
    }
    const home = process.env['MASTYF_HOME'] || join(process.env['HOME'] || '', '.mastyf');
    for (const name of CANDIDATE_NAMES) {
        const p = join(home, name);
        if (existsSync(p))
            return p;
    }
    return null;
}
export function parseSecurityProfile(raw) {
    return SecurityProfileSchema.parse(raw);
}
export function loadSecurityProfile(explicitPath) {
    const path = resolveSecurityProfilePath(explicitPath);
    if (!path) {
        return { status: 'ABSENT', profile: null, path: null, reason: 'no mcp-security.yaml found' };
    }
    try {
        const doc = load(readFileSync(path, 'utf-8'));
        const profile = parseSecurityProfile(doc);
        return { status: 'LOADED', profile, path };
    }
    catch (err) {
        return {
            status: 'INVALID',
            profile: null,
            path,
            reason: err instanceof Error ? err.message : String(err),
        };
    }
}
/** Protect-time gate: when profile LOADED + certified_only, require allowlisted servers. */
export function assertServersAllowedByProfile(profile, serverNames) {
    const allow = profile.authority.allowed_servers;
    if (!profile.mediation.certified_only && allow.length === 0) {
        return { ok: true, blocked: [] };
    }
    if (allow.length === 0 && profile.mediation.certified_only) {
        return {
            ok: false,
            blocked: serverNames,
            reason: 'certified_only set but allowed_servers empty — fail-closed',
        };
    }
    const blocked = serverNames.filter((s) => !allow.includes(s) && !allow.includes('*'));
    if (blocked.length === 0)
        return { ok: true, blocked: [] };
    return {
        ok: !profile.mediation.fail_closed ? true : false,
        blocked,
        reason: `servers not in profile allowlist: ${blocked.join(', ')}`,
    };
}
//# sourceMappingURL=security-profile.js.map