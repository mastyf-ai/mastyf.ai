export interface DlqEvent {
    exporter: string;
    event: {
        type: string;
        payload: unknown;
        timestamp: string;
    };
    attempts: number;
    lastError?: string;
    enqueuedAt: string;
}
export declare function appendExporterDlq(entry: DlqEvent): void;
export declare function loadExporterDlq(max?: number): DlqEvent[];
export declare function rewriteExporterDlq(remaining: DlqEvent[]): void;
export declare function sendWithRetry(exporterName: string, sendFn: () => Promise<void>, event: {
    type: string;
    payload: unknown;
    timestamp: string;
}): Promise<void>;
export declare function flushExporterDlq(senders: Record<string, (event: DlqEvent['event']) => Promise<void>>): Promise<number>;
//# sourceMappingURL=exporter-dlq.d.ts.map