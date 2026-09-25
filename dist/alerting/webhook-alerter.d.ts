export type AlertSeverity = 'critical' | 'high' | 'warning' | 'info' | 'medium';
export interface AlertPayload {
    severity: 'critical' | 'high' | 'medium';
    title: string;
    message: string;
    server?: string;
    tool?: string;
    timestamp: string;
    requestId?: string;
}
/** Backward-compatible alert shape (src/alerts consumers) */
export interface Alert {
    title: string;
    message: string;
    severity: 'critical' | 'warning' | 'info';
    serverName?: string;
    metadata?: Record<string, string>;
}
export interface WebhookConfig {
    url: string;
    type: 'slack' | 'pagerduty' | 'discord' | 'generic';
    token?: string;
    minSeverity: 'critical' | 'high' | 'medium';
}
export declare class WebhookAlerter {
    private configs;
    constructor(configs: WebhookConfig[]);
    alert(payload: AlertPayload): Promise<void>;
    /** Legacy src/alerts API */
    send(alert: Alert): Promise<void>;
    private deliver;
}
export declare const alerter: WebhookAlerter | null;
/**
 * Send an alert through configured webhooks (non-blocking).
 */
export declare function sendAlert(alert: Alert): Promise<void>;
/** Fire alert for policy blocks (used by proxy) */
export declare function alertPolicyBlock(serverName: string, toolName: string, rule: string, reason: string, requestId?: string): Promise<void>;
//# sourceMappingURL=webhook-alerter.d.ts.map