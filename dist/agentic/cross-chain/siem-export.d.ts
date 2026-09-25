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
export declare function fleetAlertToCef(alert: FleetChainAlert): SiemCefEvent;
export declare function formatCefLine(evt: SiemCefEvent): string;
export declare function buildIrSiemBundle(params: {
    sessionId: string;
    events: FleetChainEvent[];
    alerts: FleetChainAlert[];
}): {
    format: 'json';
    exportedAt: string;
    cef: string[];
    bundle: Record<string, unknown>;
};
//# sourceMappingURL=siem-export.d.ts.map