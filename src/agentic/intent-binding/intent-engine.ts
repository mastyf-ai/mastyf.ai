/**
 * Intent binding engine — session-scoped declared intent and tool allowlists.
 */
import { IndustryStandardStore } from '../../database/industry-standard-store.js';

export interface DeclaredIntent {
  sessionId: string;
  agentId?: string;
  intent: string;
  allowedTools: string[];
  expiresAt: string;
}

export class IntentEngine {
  private bindings = new Map<string, DeclaredIntent>();

  constructor(private readonly store?: IndustryStandardStore) {}

  declareIntent(
    sessionId: string,
    intent: string,
    allowedTools: string[],
    opts?: { agentId?: string; ttlMs?: number },
  ): DeclaredIntent {
    const expiresAt = new Date(Date.now() + (opts?.ttlMs ?? 30 * 60_000)).toISOString();
    const binding: DeclaredIntent = {
      sessionId,
      agentId: opts?.agentId,
      intent,
      allowedTools: [...new Set(allowedTools)],
      expiresAt,
    };
    this.bindings.set(sessionId, binding);
    this.store?.saveIntentBinding({
      sessionId,
      agentId: opts?.agentId,
      declaredIntent: intent,
      allowedToolsJson: JSON.stringify(binding.allowedTools),
      expiresAt,
    });
    return binding;
  }

  getIntent(sessionId: string): DeclaredIntent | null {
    const cached = this.bindings.get(sessionId);
    if (cached) {
      if (new Date(cached.expiresAt).getTime() < Date.now()) {
        this.bindings.delete(sessionId);
        return null;
      }
      return cached;
    }
    const row = this.store?.getIntentBinding(sessionId);
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) return null;
    return {
      sessionId,
      intent: row.declaredIntent,
      allowedTools: row.allowedTools,
      expiresAt: row.expiresAt,
    };
  }

  isCallAllowed(sessionId: string, toolName: string): { allowed: boolean; reason?: string } {
    const binding = this.getIntent(sessionId);
    if (!binding) return { allowed: true, reason: 'no_intent_declared' };
    if (binding.allowedTools.length === 0) return { allowed: false, reason: 'empty_allowlist' };
    const allowed = binding.allowedTools.includes(toolName) ||
      binding.allowedTools.some(t => t.endsWith('*') && toolName.startsWith(t.slice(0, -1)));
    return allowed
      ? { allowed: true }
      : { allowed: false, reason: `tool "${toolName}" not in declared intent "${binding.intent}"` };
  }
}
