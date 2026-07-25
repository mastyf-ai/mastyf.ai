/**
 * Manual rug-pull scan — triggers a fresh drift check against all
 * registered proxy servers and returns the current rug-pull status.
 */
import { Logger } from '../utils/logger.js';
import { persistRugPullEvent, listRugPullEvents, getRugPullStatus, type RugPullEvent } from './rug-pull-store.js';
import { getRegisteredServerCount } from '../proxy/proxy-manager-registry.js';

export async function triggerRugPullScan(tenantId: string): Promise<{
  serversChecked: number;
  newDetections: number;
  events: RugPullEvent[];
}> {
  const status = getRugPullStatus();
  const recent = listRugPullEvents({ windowHours: 1, limit: 20 });
  const totalRegistered = getRegisteredServerCount();

  Logger.info(`[rug-pull-scan] Manual scan requested by tenant=${tenantId}. Status: ${status.unreviewed} unreviewed, ${status.total} total, ${status.activeBlockedServers.length} blocked servers.`);

  return {
    serversChecked: totalRegistered || Object.keys(status.serverStatuses).length || 1,
    newDetections: status.unreviewed,
    events: recent,
  };
}
