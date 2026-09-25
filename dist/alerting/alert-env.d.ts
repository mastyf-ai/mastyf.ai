/**
 * Unified alert destination resolution for webhook-alerter and incident-responder.
 */
/** Slack/Discord incident webhook (canonical: ALERT_SLACK_WEBHOOK). */
export declare function getSlackWebhookUrl(): string;
/** PagerDuty Events API v2 routing key (canonical: ALERT_PAGERDUTY_KEY). */
export declare function getPagerDutyRoutingKey(): string;
export declare function isAppAlertingConfigured(): boolean;
/** Redacted summary for bootstrap logs (no secret values). */
export declare function getAlertDestinationsForLogging(): string;
//# sourceMappingURL=alert-env.d.ts.map