import { randomUUID } from 'node:crypto';
import { consumeApprovedMatch, findPendingMatch, persistApprovalRequest, } from '../audit/approval-store.js';
import { peekMatchingAllowGrant } from '../gateway-ledger/operator-grant-peek.js';
export function createApprovalHook(opts) {
    const toolSet = new Set(opts.matchTools.map(t => t.toLowerCase()));
    return {
        name: 'approval-gate',
        priority: 50,
        async beforeToolCall(context) {
            const toolName = (context.tool.toolName || '').toLowerCase();
            if (!toolSet.has(toolName))
                return { allowed: true };
            const grant = peekMatchingAllowGrant({
                toolName: context.tool.toolName || '',
                serverName: context.tool.serverName || '',
                serverId: context.tool.serverName || '',
            });
            if (grant) {
                return {
                    allowed: true,
                    reason: `Operator grant ${grant.grant_id} (consumed at /v1/decide)`,
                };
            }
            const approved = consumeApprovedMatch({
                toolName: context.tool.toolName || '',
                serverName: context.tool.serverName || '',
                tenantId: context.tenantId,
            });
            if (approved) {
                return {
                    allowed: true,
                    reason: `Local approval ${approved.approvalId} consumed (single-use)`,
                };
            }
            const pending = findPendingMatch({
                toolName: context.tool.toolName || '',
                serverName: context.tool.serverName || '',
                tenantId: context.tenantId,
            });
            if (pending) {
                return {
                    allowed: false,
                    reason: `Approval required — ID: ${pending.approvalId}. Use "mastyf-ai approve ${pending.approvalId}" to allow or wait ${opts.timeoutSeconds}s for auto-deny.`,
                };
            }
            const approvalId = randomUUID();
            const expiresAt = new Date(Date.now() + opts.timeoutSeconds * 1000).toISOString();
            const request = {
                approvalId,
                serverName: context.tool.serverName || '',
                toolName: context.tool.toolName || '',
                arguments: context.tool.arguments || {},
                tenantId: context.tenantId || 'default',
                identity: context.identity?.sub || 'unknown',
                status: 'pending',
                createdAt: new Date().toISOString(),
                expiresAt,
            };
            persistApprovalRequest({ ...request, id: approvalId });
            if (opts.notifyChannel === 'stdout' || !opts.notifyChannel) {
                console.log(`\n⚠️  APPROVAL REQUIRED: "${context.tool.toolName}" on ${context.tool.serverName}`);
                console.log(`   Approval ID: ${approvalId}`);
                console.log(`   Approve:  mastyf-ai approve ${approvalId}`);
                console.log(`   Deny:     mastyf-ai deny ${approvalId}`);
                console.log(`   Expires:  ${expiresAt}\n`);
            }
            return {
                allowed: false,
                reason: `Approval required — ID: ${approvalId}. Use "mastyf-ai approve ${approvalId}" to allow or wait ${opts.timeoutSeconds}s for auto-deny.`,
            };
        },
    };
}
//# sourceMappingURL=approval-hook.js.map