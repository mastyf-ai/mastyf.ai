import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface ApprovalRequest {
  id: string;
  approvalId: string;
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
  tenantId: string;
  identity: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

function statePath(): string {
  const dir = join(homedir(), '.mastyf-ai');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'approvals.jsonl');
}

export function persistApprovalRequest(req: ApprovalRequest): void {
  appendFileSync(statePath(), JSON.stringify(req) + '\n', 'utf-8');
}

export function listPendingApprovals(tenantId?: string): ApprovalRequest[] {
  const path = statePath();
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l) as ApprovalRequest; } catch { return null; }
    }).filter((r): r is ApprovalRequest => r !== null && r.status === 'pending')
      .filter(r => !tenantId || r.tenantId === tenantId)
      .filter(r => new Date(r.expiresAt).getTime() > Date.now())
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } catch { return []; }
}

export function resolveApproval(approvalId: string, action: 'approved' | 'denied', resolvedBy?: string): boolean {
  const path = statePath();
  if (!existsSync(path)) return false;
  const entries = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  let found = false;
  const updated = entries.map(line => {
    try {
      const r = JSON.parse(line) as ApprovalRequest;
      if (r.approvalId === approvalId && r.status === 'pending') {
        r.status = action;
        r.resolvedAt = new Date().toISOString();
        if (resolvedBy) r.resolvedBy = resolvedBy;
        found = true;
      }
      return JSON.stringify(r);
    } catch { return line; }
  });
  if (found) writeFileSync(path, updated.join('\n') + '\n', 'utf-8');
  return found;
}
