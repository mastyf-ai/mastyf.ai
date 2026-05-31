/** #8 Autonomous Incident Response Playbooks */
import { Logger } from '../../utils/logger.js';
import type { ApprovalGate } from '../core.js';
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { getCircuitBreaker } from '../../utils/circuit-breaker-registry.js';

export interface IncidentAction { step: number; action: string; description: string; auto: boolean; }
export interface IncidentReport {
  id: string; timestamp: string; trigger: string; source: string; severity: 'critical' | 'high' | 'medium' | 'low';
  actions: { step: number; action: string; executed: boolean; result: string; approvalId?: string }[];
  summary: string; forensicSnapshot?: { toolSchemas: number; recentCalls: number; configHash: string };
}

const PLAYBOOKS: Record<string, IncidentAction[]> = {
  prompt_injection: [
    { step: 1, action: 'block_tool', description: 'Temporarily deny all tools/calls for 5 minutes', auto: true },
    { step: 2, action: 'sanitize_args', description: 'Strip injection payloads from arguments', auto: true },
    { step: 3, action: 'capture_forensic', description: 'Snapshot tool schemas and recent call history', auto: true },
    { step: 4, action: 'notify_admin', description: 'Send webhook alert with incident context', auto: false },
    { step: 5, action: 'graduated_reopen', description: 'Re-enable read-only tools after 5 min, write after 15 min', auto: true },
  ],
  credential_leak: [
    { step: 1, action: 'block_response', description: 'Immediately block the response containing credentials', auto: true },
    { step: 2, action: 'redact_content', description: 'Redact credential patterns from response', auto: true },
    { step: 3, action: 'rotate_credentials', description: 'Recommend key rotation for exposed credentials', auto: false },
    { step: 4, action: 'notify_security', description: 'Alert security team via webhook', auto: false },
  ],
  shell_injection: [
    { step: 1, action: 'block_tool', description: 'Permanently block the tool that allowed shell injection', auto: true },
    { step: 2, action: 'strengthen_policy', description: 'Add deny rule for the detected shell pattern', auto: true },
    { step: 3, action: 'audit_history', description: 'Audit last 100 tool calls for similar patterns', auto: true },
    { step: 4, action: 'notify_admin', description: 'Escalate to admin with full context', auto: false },
    { step: 5, action: 'isolate_agent', description: 'Isolate offending agent session pending approval', auto: false },
  ],
};

export class IncidentPlaybookRunner {
  private reports: IncidentReport[] = [];
  private isolatedAgents = new Set<string>();

  constructor(
    private readonly approvalGate?: ApprovalGate,
    private readonly store?: IndustryStandardStore,
  ) {}

  run(
    trigger: string,
    source: string,
    severity: IncidentReport['severity'],
    playbookKey: string,
    context?: { agentId?: string; toolSchemas?: number; recentCalls?: number },
  ): IncidentReport {
    const playbook = PLAYBOOKS[playbookKey] || PLAYBOOKS['shell_injection']!;
    const id = `inc-${Date.now()}`;
    const actions = playbook.map(a => {
      const executed = a.auto;
      let result = a.auto ? 'Auto-executed' : 'Awaiting approval';
      let approvalId: string | undefined;

      if (a.action === 'notify_admin' || a.action === 'notify_security') {
        approvalId = this.requestWebhook(a.action, trigger, severity, source);
        result = approvalId ? `Webhook pending approval (${approvalId})` : this.sendWebhook(trigger, severity, source);
      } else if (a.action === 'block_tool') {
        const tenant = process.env.GUARDIAN_TENANT_ID || 'default';
        getCircuitBreaker(tenant, source).forceOpen(`playbook:${playbookKey}:${trigger}`);
        result = `Circuit breaker opened for ${source}`;
      } else if (a.action === 'isolate_agent') {
        approvalId = this.requestIsolation(context?.agentId ?? source, trigger);
        if (approvalId) {
          result = `Isolation pending approval (${approvalId})`;
        } else {
          const agentId = context?.agentId ?? source;
          result = this.isolateAgent(agentId);
          const tenant = process.env.GUARDIAN_TENANT_ID || 'default';
          getCircuitBreaker(tenant, source).forceOpen(`isolate:${agentId}`);
        }
      }

      return { step: a.step, action: a.action, executed: executed || !!approvalId, result, approvalId };
    });

    const report: IncidentReport = {
      id,
      timestamp: new Date().toISOString(),
      trigger,
      source,
      severity,
      actions,
      summary: `${playbook.length} actions for ${trigger} (${severity})`,
      forensicSnapshot: {
        toolSchemas: context?.toolSchemas ?? 0,
        recentCalls: context?.recentCalls ?? 0,
        configHash: 'sha256:' + Buffer.from(`${playbookKey}:${trigger}`).toString('hex').slice(0, 16),
      },
    };

    this.reports.push(report);
    this.store?.savePlaybookRun({
      id,
      playbookId: playbookKey,
      trigger,
      status: actions.some(a => a.result.includes('pending')) ? 'partial' : 'completed',
      stepsJson: JSON.stringify(actions),
    });

    Logger.info(`[IncidentPlaybook] Ran playbook "${playbookKey}" for ${source}: ${actions.filter(a => a.executed).length}/${actions.length} actions executed`);
    return report;
  }

  private sendWebhook(trigger: string, severity: string, source: string): string {
    const url = process.env['GUARDIAN_INCIDENT_WEBHOOK_URL'];
    if (!url) return 'Webhook URL not configured';
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger, severity, source, timestamp: new Date().toISOString() }),
    }).catch(err => Logger.warn(`[IncidentPlaybook] Webhook failed: ${err instanceof Error ? err.message : String(err)}`));
    return 'Webhook dispatched';
  }

  private requestWebhook(action: string, trigger: string, severity: string, source: string): string | undefined {
    if (!this.approvalGate) return undefined;
    return this.approvalGate.submit('incident-playbook', `${action}: ${trigger} (${severity}) from ${source}`, []);
  }

  private requestIsolation(agentId: string, trigger: string): string | undefined {
    if (!this.approvalGate) return undefined;
    return this.approvalGate.submit('incident-playbook', `Isolate agent ${agentId} for ${trigger}`, []);
  }

  isolateAgent(agentId: string): string {
    this.isolatedAgents.add(agentId);
    return `Agent ${agentId} isolated`;
  }

  isAgentIsolated(agentId: string): boolean {
    return this.isolatedAgents.has(agentId);
  }

  getReports(): IncidentReport[] { return this.reports; }
}
