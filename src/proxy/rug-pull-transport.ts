/**
 * Shared rug-pull checks for HTTP/SSE/streamable transports.
 */
import {
  applyToolFingerprintFromResult,
  type ToolFingerprintState,
} from './tool-fingerprint.js';
import { isClusterRugPullActive, publishRugPullAlert } from './rug-pull-cluster.js';

export async function isRugPullBlockedForCall(
  state: ToolFingerprintState,
  serverName: string,
  tenantId: string,
): Promise<boolean> {
  if (state.blocked) return true;
  return isClusterRugPullActive(serverName, tenantId);
}

export function fingerprintJsonRpcToolsList(
  state: ToolFingerprintState,
  payload: unknown,
  serverName: string,
  tenantId: string,
  logPrefix?: string,
): void {
  if (!payload || typeof payload !== 'object') return;
  const msg = payload as { result?: unknown };
  if (!msg.result) return;
  applyToolFingerprintFromResult(state, msg.result, {
    serverName,
    tenantId,
    logPrefix,
    onMismatch: async () => {
      void publishRugPullAlert(serverName, tenantId, state.fingerprint || '');
    },
  });
}
