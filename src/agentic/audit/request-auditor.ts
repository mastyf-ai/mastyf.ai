/**
 * Per-Request Audit Trail — records every MCP request through the proxy
 * with full parameters (redacted), user identity, latency, result.
 */
import { Logger } from '../../utils/logger.js';

export interface AuditRecord {
  recordId: string;
  timestamp: string;
  sessionId: string;
  method: string;
  toolName?: string;
  /** Arguments with values redacted (only keys + type info) */
  argsSummary: string;
  userId?: string;
  userTier?: string;
  latencyMs: number;
  blocked: boolean;
  blockReason?: string;
  responseSize: number;
  statusCode: string;
}

export class RequestAuditor {
  private records: AuditRecord[] = [];
  private readonly maxRecords: number;

  constructor(maxRecords: number = 10000) {
    this.maxRecords = maxRecords;
  }

  record(params: {
    sessionId: string;
    method: string;
    toolName?: string;
    args?: Record<string, unknown>;
    userId?: string;
    userTier?: string;
    latencyMs: number;
    blocked: boolean;
    blockReason?: string;
    responseSize: number;
    statusCode: string;
  }): AuditRecord {
    // Redact argument values — only preserve keys and types
    const argsSummary = this.redactArgs(params.args);

    const record: AuditRecord = {
      recordId: `audit-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      timestamp: new Date().toISOString(),
      sessionId: params.sessionId,
      method: params.method,
      toolName: params.toolName,
      argsSummary,
      userId: params.userId,
      userTier: params.userTier,
      latencyMs: params.latencyMs,
      blocked: params.blocked,
      blockReason: params.blockReason,
      responseSize: params.responseSize,
      statusCode: params.statusCode,
    };

    this.records.push(record);

    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    return record;
  }

  /** Redact argument values — only keep keys and types. */
  private redactArgs(args?: Record<string, unknown>): string {
    if (!args || Object.keys(args).length === 0) return '{}';
    const summary: Record<string, string> = Object.create(null); // keys come from tool args
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        summary[key] = `string(${value.length} chars)`;
      } else if (typeof value === 'number') {
        summary[key] = `number(${value})`;
      } else if (typeof value === 'boolean') {
        summary[key] = `boolean(${value})`;
      } else if (Array.isArray(value)) {
        summary[key] = `array(${value.length} items)`;
      } else if (value === null || value === undefined) {
        summary[key] = `${value}`;
      } else {
        summary[key] = 'object';
      }
    }
    return JSON.stringify(summary);
  }

  /** Get recent audit records. */
  getRecords(limit: number = 50): AuditRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /** Get records filtered by method. */
  getRecordsByMethod(method: string, limit: number = 50): AuditRecord[] {
    return this.records
      .filter(r => r.method === method)
      .slice(-limit)
      .reverse();
  }

  /** Get records filtered by session. */
  getRecordsBySession(sessionId: string, limit: number = 50): AuditRecord[] {
    return this.records
      .filter(r => r.sessionId === sessionId)
      .slice(-limit)
      .reverse();
  }

  /** Get audit statistics. */
  getStats(): {
    totalRecords: number;
    totalBlocked: number;
    totalAllowed: number;
    averageLatencyMs: number;
  } {
    const total = this.records.length;
    const blocked = this.records.filter(r => r.blocked).length;
    const avgLatency = total > 0
      ? Math.round(this.records.reduce((s, r) => s + r.latencyMs, 0) / total)
      : 0;

    return {
      totalRecords: total,
      totalBlocked: blocked,
      totalAllowed: total - blocked,
      averageLatencyMs: avgLatency,
    };
  }
}