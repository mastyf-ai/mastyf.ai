/**
 * A1 — SIEM / IR export helpers (CEF + JSON bundle).
 */
import type { FleetChainAlert, FleetChainEvent } from './fleet-chain-detector.js';

export interface SiemCefEvent {
  version: string;
  deviceVendor: string;
  deviceProduct: string;
  signatureId: string;
  name: string;
  severity: number;
  extension: Record<string, string | number>;
}

export function fleetAlertToCef(alert: FleetChainAlert): SiemCefEvent {
  return {
    version: '0',
    deviceVendor: 'MCP Guardian',
    deviceProduct: 'FleetChainDetector',
    signatureId: alert.pattern,
    name: `Cross-MCP attack chain: ${alert.pattern}`,
    severity: alert.confidence >= 0.8 ? 9 : alert.confidence >= 0.6 ? 7 : 5,
    extension: {
      cs1: alert.globalSessionId,
      cs1Label: 'sessionId',
      cs2: alert.agents.join(','),
      cs2Label: 'agents',
      cs3: alert.servers.join(','),
      cs3Label: 'servers',
      cs4: alert.mitreTechniques.join(','),
      cs4Label: 'mitreTechniques',
      cn1: Math.round(alert.confidence * 100),
      cn1Label: 'confidencePct',
      msg: alert.description,
    },
  };
}

export function formatCefLine(evt: SiemCefEvent): string {
  const ext = Object.entries(evt.extension)
    .map(([k, v]) => `${k}=${String(v).replace(/([\\|=])/g, '\\$1')}`)
    .join(' ');
  return `CEF:${evt.version}|${evt.deviceVendor}|${evt.deviceProduct}|1.0|${evt.signatureId}|${evt.name}|${evt.severity}|${ext}`;
}

export function buildIrSiemBundle(params: {
  sessionId: string;
  events: FleetChainEvent[];
  alerts: FleetChainAlert[];
}): { format: 'json'; exportedAt: string; cef: string[]; bundle: Record<string, unknown> } {
  const cef = params.alerts.map((a) => formatCefLine(fleetAlertToCef(a)));
  return {
    format: 'json',
    exportedAt: new Date().toISOString(),
    cef,
    bundle: {
      sessionId: params.sessionId,
      eventCount: params.events.length,
      alertCount: params.alerts.length,
      events: params.events,
      alerts: params.alerts,
    },
  };
}
