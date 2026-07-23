/**
 * Lifecycle assurance gates — rug-pull drift, CVE, registration corpus (Defense Fabric phase 3).
 */
import type { IDatabase } from '../database/database-interface.js';
import type { ToolFingerprintState } from './tool-fingerprint.js';
import type { ToolDefinition } from '@mastyf_ai/core';
import { evaluateCveGate } from '../utils/cve-gate.js';
import { isRugPullBlockedForCall } from './rug-pull-transport.js';
import {
  evaluateToolRegistrationGate,
  registerToolsFromList,
} from './tool-registration-gate.js';

export interface LifecycleGateResult {
  block: boolean;
  phase?: 'rug-pull' | 'cve' | 'registration';
  rule?: string;
  reason?: string;
  code?: number;
}

export async function runLifecycleAssuranceGates(input: {
  serverName: string;
  toolName: string;
  tenantId: string;
  rugPullState?: ToolFingerprintState;
  db?: IDatabase;
}): Promise<LifecycleGateResult> {
  if (input.rugPullState) {
    const rugPull = await isRugPullBlockedForCall(
      input.rugPullState,
      input.serverName,
      input.tenantId,
    );
    if (rugPull) {
      return {
        block: true,
        phase: 'rug-pull',
        rule: 'tool-fingerprint-mismatch',
        reason: 'Tool catalog changed mid-session (rug-pull protection)',
        code: -32001,
      };
    }
  }

  if (input.db) {
    const cve = await evaluateCveGate(input.db, input.serverName);
    if (cve.block) {
      return {
        block: true,
        phase: 'cve',
        rule: 'cve-gate',
        reason: cve.reason ?? 'Server blocked due to CVE policy',
        code: -32001,
      };
    }
  }

  const reg = evaluateToolRegistrationGate(input.serverName, input.toolName);
  if (reg.block) {
    return {
      block: true,
      phase: 'registration',
      rule: reg.rule ?? 'registration-corpus-critical',
      reason: reg.reason ?? 'Tool blocked by registration scan',
      code: -32001,
    };
  }

  return { block: false };
}

export function onToolsListObserved(
  serverName: string,
  tools: ToolDefinition[],
): void {
  registerToolsFromList(serverName, tools);
}
