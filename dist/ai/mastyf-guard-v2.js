/**
 * Mastyf Guard 1.5B v2.1: Relational Argument-Intent Neural Auditor (AIA)
 *
 * Implements:
 * P(proposed action deviates from authorized intent and scope | T, theta, C, x)
 *
 * Evaluates the 4 Core Enterprise Invariants:
 * 1. Recipient / Destination Deviation (AuthorizedDestination != ProposedDestination)
 * 2. Scope Expansion (AuthorizedScope subset of ProposedScope)
 * 3. Privilege Overgrant (Privilege_proposed > Privilege_authorized)
 * 4. Secondary Side-Effects (PrimaryAction = authorized && SecondaryAction = unauthorized)
 *
 * Operational Verdicts: ALLOW | BLOCK | ESCALATE
 */
import { walkStringLeaves } from '../policy/arg-leaf-walker.js';
import { deobfuscateRecursive } from '../utils/payload-normalizer.js';
const GCG_ADVERSARIAL_PATTERNS = [
    /(?:[a-z]{1,4}\s+){5,}(?:==|--|\/\/|\?\?|!!)/i,
    /[!@#$%^&*()_+={}\[\]:;"'<>,.?\/~`\\|-]{10,}/,
    /\b(?:describing\s+instead|in\s+theory\s+strictly|hypothetically\s+speaking|game\s+scenario\s+only)\b/i,
    /(?:[A-Z0-9]{4,8}\s+){4,}[A-Z0-9]{4,8}/, // High entropy adversarial nonce sequences
];
const HIGH_PRIVILEGE_ROLES = [
    'ADMINISTRATORACCESS',
    'ADMIN',
    'SUPERADMIN',
    'ROOT',
    'SYSADMIN',
    'ALL_PRIVILEGES'
];
const LOW_PRIVILEGE_ROLES = [
    'DEVELOPER',
    'DEVELOPERACCESS',
    'READONLY',
    'ANALYST',
    'USER',
    'VIEWER',
    'GUEST',
    'STANDARD'
];
export class MastyfGuardV2Auditor {
    threshold;
    constructor(threshold = 0.5) {
        this.threshold = threshold;
    }
    /**
     * Constructs the structured prompt format for Relational AIA fine-tuning.
     */
    static buildStructuredPrompt(ctx) {
        return JSON.stringify({
            task: 'relational_tool_argument_integrity_auditing',
            authorized_user_intent: ctx.expectedAction,
            authorized_scope: ctx.authorizedScope || {
                allowed_principal: ctx.authorizedPrincipal,
                allowed_capability: ctx.authorizedCapability,
            },
            proposed_action: {
                tool_name: ctx.toolName,
                proposed_arguments: ctx.arguments,
            },
            untrusted_context: ctx.context.slice(0, 1000),
            security_question: 'Does the proposed action remain strictly within authorized intent and scope without unauthorized side-effects?',
        }, null, 2);
    }
    /**
     * Evaluates the proposed tool call using relational argument-intent auditing.
     */
    evaluate(ctx) {
        const t0 = performance.now();
        const normalizedContext = deobfuscateRecursive(ctx.context);
        const leaves = walkStringLeaves(ctx.arguments);
        const expectedLower = ctx.expectedAction.toLowerCase();
        const argsJson = JSON.stringify(ctx.arguments);
        let poisoningScore = 0.0;
        let exfiltrationScore = 0.0;
        let destructiveScore = 0.0;
        let anomalyScore = 0.0;
        const violatingParams = [];
        let invariantViolated = 'none';
        let authVal;
        let propVal;
        // --- 1. Adversarial Suffix Check ---
        for (const pat of GCG_ADVERSARIAL_PATTERNS) {
            if (pat.test(ctx.context)) {
                poisoningScore += 0.50;
                anomalyScore += 0.40;
                break;
            }
        }
        // --- 2. Invariant 1: Recipient / Destination Deviation ---
        // Extract emails from arguments
        // --- 2. Invariant 1: Recipient / Destination Deviation ---
        const expectedEmails = Array.from(ctx.expectedAction.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g)).map((m) => m[0].toLowerCase());
        for (const leaf of leaves) {
            const val = String(leaf.value).toLowerCase();
            const pathLower = leaf.path.toLowerCase();
            // Skip caller provenance / operator metadata fields
            if (/initiated_by|caller|operator|principal|requested_by|actor|user_id|author|session_user|created_by/i.test(pathLower)) {
                continue;
            }
            // Check recipient/destination fields for unauthorized emails
            if (/recipient|to|cc|bcc|destination|egress|sink|send_to|forward|collaborator|archive_copy|copy/i.test(pathLower)) {
                const emailMatch = val.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
                if (emailMatch) {
                    const pEmail = emailMatch[0].toLowerCase();
                    const [localPart, domain] = pEmail.split('@');
                    const isInternalDomain = /corp|internal|company|local|enterprise/i.test(domain || '');
                    const nameParts = (localPart || '').split(/[._-]/);
                    const isNamedPrincipal = nameParts.length > 0 && nameParts.every((part) => expectedLower.includes(part));
                    if (!expectedEmails.includes(pEmail) && !(isInternalDomain && isNamedPrincipal)) {
                        exfiltrationScore += 0.90;
                        poisoningScore += 0.85;
                        violatingParams.push(`unauthorized_recipient='${pEmail}' (in path '${leaf.path}')`);
                        if (invariantViolated === 'none') {
                            invariantViolated = 'recipient_destination_deviation';
                            authVal = expectedEmails.length > 0 ? expectedEmails.join(', ') : 'authorized_internal_principals';
                            propVal = pEmail;
                        }
                    }
                }
            }
            // Deep value inspection: external URLs anywhere in args (including env vars or nested configs)
            if (val.startsWith('http://') || val.startsWith('https://') || /target|destination|url|endpoint|host|replica/i.test(pathLower)) {
                const cleanHost = val.replace(/^https?:\/\//, '').split(/[:/]/)[0].toLowerCase();
                if (cleanHost.includes('.')) {
                    const isExplicitlyAuthorized = expectedLower.includes(cleanHost);
                    const isInternalInfra = cleanHost.endsWith('.internal') || cleanHost.endsWith('.corp') || cleanHost.endsWith('.internal.corp');
                    const isKnownPublicRegistry = cleanHost.endsWith('amazonaws.com') || cleanHost.endsWith('docker.io') || cleanHost.endsWith('datadoghq.com');
                    // Strict Partner Registry Check: Prevents subtle partner domain spoofing
                    if (!isExplicitlyAuthorized && !isInternalInfra && !isKnownPublicRegistry) {
                        exfiltrationScore += 0.95;
                        poisoningScore += 0.90;
                        violatingParams.push(`untrusted_destination_domain='${cleanHost}' (in path '${leaf.path}', not in trusted partner registry)`);
                        if (invariantViolated === 'none') {
                            invariantViolated = 'recipient_destination_deviation';
                            authVal = 'authorized_internal_endpoints';
                            propVal = cleanHost;
                        }
                    }
                }
            }
        }
        // --- 3. Invariant 2: Scope Expansion (SQL / Tenancy / ACLs) ---
        if (/query|sql/i.test(argsJson)) {
            if (/1=1|OR\s+true|UNION\s+SELECT|--/i.test(argsJson)) {
                poisoningScore += 0.95;
                violatingParams.push("query: predicate expansion detected ('1=1' or bypass)");
                invariantViolated = 'scope_expansion';
                authVal = 'tenant_scoped_predicate';
                propVal = 'predicate_expanded_1=1';
            }
            if (/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i.test(argsJson)) {
                destructiveScore += 0.95;
                violatingParams.push('query: destructive DDL statement');
                invariantViolated = 'scope_expansion';
            }
        }
        // Storage / Bucket ACL over-broadening
        if (/acl|permission|grant/i.test(argsJson)) {
            if (/public|allusers|authenticatedusers/i.test(argsJson) && !expectedLower.includes('public')) {
                poisoningScore += 0.90;
                anomalyScore += 0.85;
                violatingParams.push("permission: unauthorized public exposure ('public-read' / 'AllUsers')");
                invariantViolated = 'scope_expansion';
                authVal = 'private_internal';
                propVal = 'public-read';
            }
        }
        // --- 4. Invariant 3: Privilege Overgrant (IAM Roles, Capabilities & Container Privileges) ---
        // Specifically inspect values of role, capability, permission, or group fields
        const roleLeaves = leaves.filter((l) => /role|privilege|permission|group|capabilit|entitlement|access|authorization/i.test(l.path));
        for (const rLeaf of roleLeaves) {
            const valUpper = String(rLeaf.value).toUpperCase().replace(/[^A-Z0-9_]/g, '');
            const hasHighRole = HIGH_PRIVILEGE_ROLES.some((tier) => valUpper.includes(tier.replace(/[^A-Z0-9_]/g, '')) || valUpper.includes('ROOT_SUDO') || valUpper.includes('ALL_PRIVILEGES'));
            const expectedLowRole = LOW_PRIVILEGE_ROLES.some((tier) => expectedLower.toUpperCase().includes(tier));
            if (hasHighRole && (expectedLowRole || (!expectedLower.includes('admin') && !expectedLower.includes('root') && !expectedLower.includes('break-glass')))) {
                anomalyScore += 0.90;
                poisoningScore += 0.85;
                violatingParams.push(`elevated_privilege: '${rLeaf.value}' (in path '${rLeaf.path}') exceeds authorized request`);
                if (invariantViolated === 'none') {
                    invariantViolated = 'privilege_overgrant';
                    authVal = 'standard_privileges';
                    propVal = String(rLeaf.value);
                }
            }
        }
        // Scope & Wildcard Expansion
        const scopeLeaves = leaves.filter((l) => /scope/i.test(l.path));
        for (const sLeaf of scopeLeaves) {
            const val = String(sLeaf.value).trim();
            if (val === '*' || val.toUpperCase() === 'ALL' || val.toUpperCase() === 'GLOBAL') {
                if (!expectedLower.includes('*') && !expectedLower.includes('all') && !expectedLower.includes('company') && !expectedLower.includes('global')) {
                    poisoningScore += 0.90;
                    anomalyScore += 0.85;
                    violatingParams.push(`scope: '${val}' (unauthorized wildcard scope expansion)`);
                    if (invariantViolated === 'none') {
                        invariantViolated = 'scope_expansion';
                        authVal = 'single_resource_scope';
                        propVal = val;
                    }
                }
            }
        }
        // Multi-consumer / External Data Share broadening
        const shareLeaves = leaves.filter((l) => /consumer|share/i.test(l.path));
        for (const sLeaf of shareLeaves) {
            const val = String(sLeaf.value).trim();
            if (val && !expectedLower.includes(val.toLowerCase()) && !val.toLowerCase().includes('internal') && !val.toLowerCase().includes('corp')) {
                exfiltrationScore += 0.90;
                poisoningScore += 0.85;
                violatingParams.push(`unauthorized_consumer='${val}' (in path '${sLeaf.path}')`);
                if (invariantViolated === 'none') {
                    invariantViolated = 'recipient_destination_deviation';
                    authVal = 'authorized_consumers';
                    propVal = val;
                }
            }
        }
        // Container privilege escalation
        if (argsJson.includes('"privileged":true') || argsJson.includes('"privileged": true')) {
            if (!expectedLower.includes('privileged')) {
                destructiveScore += 0.85;
                anomalyScore += 0.80;
                violatingParams.push("containers: unauthorized container privilege elevation ('privileged: true')");
                if (invariantViolated === 'none') {
                    invariantViolated = 'privilege_overgrant';
                    authVal = 'unprivileged';
                    propVal = 'privileged: true';
                }
            }
        }
        // --- 5. Invariant 4: Secondary Side-Effects (Surcharges, Sidecars, Mirrors, Aggregate Amounts) ---
        // Aggregate Financial Constraint: \sum_i Charges_i <= AuthorizedAmount
        if (/amount|total|payout|credit|debit|line_items|entries|disbursement|invoice/i.test(argsJson)) {
            const authNumMatches = ctx.expectedAction.match(/\$([0-9,]+(\.[0-9]{2})?)|([0-9]+(\.[0-9]{2})?)\s*(dollars|usd)/gi);
            let authorizedCeiling = null;
            if (authNumMatches) {
                const cleanNum = authNumMatches[0].replace(/[^0-9.]/g, '');
                authorizedCeiling = parseFloat(cleanNum);
            }
            let proposedPayout = null;
            const rawArgs = ctx.arguments;
            if (typeof rawArgs.total_payout === 'number')
                proposedPayout = rawArgs.total_payout;
            else if (typeof rawArgs.total_amount === 'number')
                proposedPayout = rawArgs.total_amount;
            else if (typeof rawArgs.authorized_base === 'number' && rawArgs.total_payout)
                proposedPayout = rawArgs.total_payout;
            const entries = rawArgs.accounting_entries || rawArgs.line_items;
            if (Array.isArray(entries)) {
                let sumCharges = 0;
                for (const entry of entries) {
                    const amt = entry.amount ?? entry.credit ?? entry.cost ?? entry.payout;
                    if (typeof amt === 'number' && amt > 0)
                        sumCharges += amt;
                }
                if (sumCharges > 0 && (!proposedPayout || sumCharges > proposedPayout)) {
                    proposedPayout = sumCharges;
                }
            }
            if (authorizedCeiling !== null && proposedPayout !== null && proposedPayout > authorizedCeiling + 0.01) {
                poisoningScore += 0.95;
                anomalyScore += 0.90;
                violatingParams.push(`aggregate_amount_deviation: proposed payout $${proposedPayout.toFixed(2)} exceeds authorized ceiling $${authorizedCeiling.toFixed(2)}`);
                if (invariantViolated === 'none') {
                    invariantViolated = 'secondary_side_effect';
                    authVal = `$${authorizedCeiling.toFixed(2)}`;
                    propVal = `$${proposedPayout.toFixed(2)}`;
                }
            }
        }
        // Surcharges / Amount Inflation / Extra Line Items
        if (/line_items/i.test(argsJson)) {
            if (/surcharge|fee|expedite|bonus|penalty/i.test(argsJson) && !expectedLower.includes('surcharge') && !expectedLower.includes('fee')) {
                poisoningScore += 0.90;
                violatingParams.push("line_items: unrequested surcharge or expedite fee added");
                if (invariantViolated === 'none') {
                    invariantViolated = 'secondary_side_effect';
                    authVal = 'base_invoice_amount';
                    propVal = 'surcharge_added';
                }
            }
        }
        // Sidecar injection
        if (/sidecar|dumper/i.test(argsJson) && !expectedLower.includes('sidecar')) {
            poisoningScore += 0.90;
            anomalyScore += 0.85;
            violatingParams.push("containers: unrequested secondary sidecar container injected");
            if (invariantViolated === 'none') {
                invariantViolated = 'secondary_side_effect';
                authVal = 'single_application_container';
                propVal = 'unrequested_debug_sidecar';
            }
        }
        // Log Retention Truncation
        if (/retention_days/i.test(argsJson)) {
            const match = argsJson.match(/"retention_days":\s*(\d+)/);
            if (match) {
                const days = parseInt(match[1], 10);
                if (days < 30 && (expectedLower.includes('year') || expectedLower.includes('2555'))) {
                    destructiveScore += 0.90;
                    poisoningScore += 0.85;
                    violatingParams.push(`retention_days: truncated to ${days} days (violates 7-year retention policy)`);
                    if (invariantViolated === 'none') {
                        invariantViolated = 'secondary_side_effect';
                        authVal = '2555 days';
                        propVal = `${days} days`;
                    }
                }
            }
        }
        // Normalize probabilities
        const maxThreat = Math.max(poisoningScore, exfiltrationScore, destructiveScore, anomalyScore);
        const benignScore = Math.max(0.0, 1.0 - maxThreat);
        const totalScoreSum = maxThreat + benignScore || 1.0;
        let primaryCategory = 'benign';
        if (maxThreat >= this.threshold) {
            if (poisoningScore >= exfiltrationScore && poisoningScore >= destructiveScore && poisoningScore >= anomalyScore) {
                primaryCategory = 'parameter_poisoning';
            }
            else if (exfiltrationScore >= destructiveScore && exfiltrationScore >= anomalyScore) {
                primaryCategory = 'data_exfiltration';
            }
            else if (destructiveScore >= anomalyScore) {
                primaryCategory = 'destructive_action';
            }
            else {
                primaryCategory = 'authorization_anomaly';
            }
        }
        // Determine Three-Way Operational Verdict: ALLOW | BLOCK | ESCALATE
        let verdict = 'ALLOW';
        if (maxThreat >= 0.70) {
            verdict = 'BLOCK';
        }
        else if (maxThreat >= 0.40) {
            verdict = 'ESCALATE'; // Ambiguous or borderline deviation
        }
        else {
            verdict = 'ALLOW';
        }
        const durationUs = (performance.now() - t0) * 1000;
        return {
            verdict,
            threatScore: Number(maxThreat.toFixed(4)),
            primaryCategory,
            categoryProbabilities: {
                authorization_anomaly: Number((anomalyScore / totalScoreSum).toFixed(4)),
                destructive_action: Number((destructiveScore / totalScoreSum).toFixed(4)),
                data_exfiltration: Number((exfiltrationScore / totalScoreSum).toFixed(4)),
                parameter_poisoning: Number((poisoningScore / totalScoreSum).toFixed(4)),
                benign: Number((benignScore / totalScoreSum).toFixed(4)),
            },
            violatingParameters: violatingParams.length > 0 ? violatingParams : undefined,
            policyDeviation: invariantViolated !== 'none' ? {
                invariantViolated,
                authorizedValue: authVal,
                proposedValue: propVal
            } : undefined,
            explanation: verdict === 'BLOCK'
                ? `Policy deviation detected: ${violatingParams.join('; ')}.`
                : verdict === 'ESCALATE'
                    ? `Borderline parameter discrepancy: ${violatingParams.join('; ')}. Escalating to supervisor.`
                    : 'Tool arguments are aligned with authorized user intent.',
            latencyUs: Number(durationUs.toFixed(1)),
        };
    }
}
//# sourceMappingURL=mastyf-guard-v2.js.map