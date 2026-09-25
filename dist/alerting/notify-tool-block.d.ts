export interface NotifyToolBlockOptions {
    serverName: string;
    toolName: string;
    rule: string;
    reason: string;
    requestId?: string | number;
    anomalyScore?: number;
}
/** Push policy-block alerts to webhooks and incident automation (all proxy transports). */
export declare function notifyToolBlock(opts: NotifyToolBlockOptions): void;
//# sourceMappingURL=notify-tool-block.d.ts.map