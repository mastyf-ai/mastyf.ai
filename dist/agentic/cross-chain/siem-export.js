export function fleetAlertToCef(alert) {
    return {
        version: '0',
        deviceVendor: 'Mastyf AI',
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
export function formatCefLine(evt) {
    const ext = Object.entries(evt.extension)
        .map(([k, v]) => `${k}=${String(v).replace(/([\\|=])/g, '\\$1')}`)
        .join(' ');
    return `CEF:${evt.version}|${evt.deviceVendor}|${evt.deviceProduct}|1.0|${evt.signatureId}|${evt.name}|${evt.severity}|${ext}`;
}
export function buildIrSiemBundle(params) {
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
//# sourceMappingURL=siem-export.js.map