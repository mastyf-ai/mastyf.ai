import { randomUUID } from 'node:crypto';
import type { BeforeToolCallHook, HookContext } from './tool-call-hooks.js';
import { persistApprovalRequest, type ApprovalRequest } from '../audit/approval-store.js';

export interface ApprovalHookOptions {
  matchTools: string[];
  approvers: string[];
  timeoutSeconds: number;
  notifyChannel?: 'slack' | 'webhook' | 'stdout';
}

export function createApprovalHook(opts: ApprovalHookOptions): BeforeToolCallHook {
  const toolSet = new Set(opts.matchTools.map(t => t.toLowerCase()));

  return {
    name: 'approval-gate',
    priority: 50,
    async beforeToolCall(context: HookContext): Promise<{ allowed: boolean; reason?: string; modifiedArgs?: Record<string, unknown> }> {
      const toolName = (context.tool.toolName || '').toLowerCase();
      if (!toolSet.has(toolName)) return { allowed: true };

      const approvalId = randomUUID();
      const expiresAt = new Date(Date.now() + opts.timeoutSeconds * 1000).toISOString();

      const request: Omit<ApprovalRequest, 'id'> = {
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
