/**
 * Shared rug-pull checks for HTTP/SSE/streamable transports.
 */
import {
  applyToolFingerprintFromResult,
  type ToolFingerprintState,
  type ToolListEntry,
} from './tool-fingerprint.js';
import { isClusterRugPullActive, publishRugPullAlert } from './rug-pull-cluster.js';
import { onToolsListObserved } from './lifecycle-assurance-gates.js';

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
  const tools = (msg.result as { tools?: ToolListEntry[] }).tools;
  if (Array.isArray(tools) && tools.length > 0) {
    const namedTools = tools.filter(
      (t): t is ToolListEntry & { name: string } => typeof t?.name === 'string',
    );
    onToolsListObserved(serverName, namedTools as unknown as Parameters<typeof onToolsListObserved>[1]);
  }
  applyToolFingerprintFromResult(state, msg.result, {
    serverName,
    tenantId,
    logPrefix,
    onMismatch: async () => {
      void publishRugPullAlert(serverName, tenantId, state.fingerprint || '');
    },
  });
}
