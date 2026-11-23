import type { ProxyCallRecord } from '../types.js';
export interface ActivityEvent {
    id: string;
    occurredAt: string;
    agent: string | null;
    server: string;
    tool: string;
    direction: 'call' | 'result' | 'action';
    verdict: 'allow' | 'block' | 'flag' | 'held';
    rule: string | null;
    reason: string | null;
    latencyMs: number | null;
    fingerprint: string | null;
    snippet: string | null;
}
export interface ActivitySink {
    key: string;
    instanceId: string;
    baseUrl: string;
    device: string | undefined;
    deviceSecret?: string;
}
/** Where to send, or null to send nothing. Shield's launcher sets the key; `connect` saves it. */
export declare function resolveActivitySink(env?: NodeJS.ProcessEnv, home?: string): ActivitySink | null;
/**
 * One call as the site stores it. `msg` is the request, used for the snippet when the record has none;
 * `fingerprintKey` is the workspace key (no key, no fingerprint).
 */
export declare function eventFromCallRecord(record: ProxyCallRecord, msg: unknown, agent: string | undefined, fingerprintKey?: string): ActivityEvent;
export declare class ActivityUploader {
    private readonly sink;
    private queue;
    private timer;
    private sending;
    private refused;
    private readonly fetchImpl;
    private readonly maxBatch;
    private readonly maxQueue;
    constructor(sink: ActivitySink, opts?: {
        fetchImpl?: typeof fetch;
        flushMs?: number;
        maxBatch?: number;
        maxQueue?: number;
    });
    enqueue(event: ActivityEvent): void;
    fingerprintKey(): string;
    pending(): number;
    flush(): Promise<void>;
    stop(): void;
}
/** The process-wide sender, or null when there is nowhere to send. */
export declare function activityUploader(): ActivityUploader | null;
/** Queue one checked call. Never throws: activity must not affect the call itself. */
export declare function recordActivity(record: ProxyCallRecord, msg?: unknown): void;
export declare function resetActivityUploaderForTests(): void;
//# sourceMappingURL=activity-uploader.d.ts.map