/**
 * Policy Audit Trail — records every policy change for compliance.
 * Logs: who changed what, when, old/new values, and rollback info.
 * Enable with: POLICY_AUDIT_ENABLED=true
 */
import { createHash } from 'crypto';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { Logger } from './logger.js';
import { appendChainedJsonlLine, isAuditHashChainEnabled } from './audit-hash-chain.js';
import { resolveTenantPolicyAuditJsonl } from '../audit/tenant-audit-paths.js';
export class PolicyAuditor {
    auditPath;
    enabled;
    lastHash = null;
    constructor(auditPath, tenantId) {
        this.enabled = process.env['POLICY_AUDIT_ENABLED'] === 'true';
        this.auditPath =
            auditPath
                || process.env['POLICY_AUDIT_LOG']
                || (process.env['MASTYF_AI_TENANT_AUDIT_PATHS'] !== 'false'
                    ? resolveTenantPolicyAuditJsonl(tenantId)
                    : './policy-audit.jsonl');
    }
    record(change) {
        if (!this.enabled)
            return;
        try {
            const residencyRegion = process.env.MASTYF_AI_REGION || 'default';
            const payload = { ...change, source: 'mastyf-ai-policy-auditor', residency_region: residencyRegion };
            if (isAuditHashChainEnabled()) {
                appendChainedJsonlLine(this.auditPath, payload);
            }
            else {
                const line = JSON.stringify(payload) + '\n';
                writeFileSync(this.auditPath, line, { flag: 'a' });
            }
            Logger.debug(`[policy-auditor] Change recorded: ${change.change}`);
        }
        catch (err) {
            Logger.error(`[policy-auditor] Failed to write audit log: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    readAuditTrail() {
        if (!existsSync(this.auditPath))
            return [];
        try {
            const content = readFileSync(this.auditPath, 'utf-8');
            return content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
        }
        catch {
            return [];
        }
    }
    computeHash(content) {
        return createHash('sha256').update(content).digest('hex');
    }
    hasChanged(content) {
        const currentHash = this.computeHash(content);
        if (this.lastHash && this.lastHash !== currentHash) {
            this.lastHash = currentHash;
            return true;
        }
        this.lastHash = currentHash;
        return false;
    }
}
//# sourceMappingURL=policy-auditor.js.map