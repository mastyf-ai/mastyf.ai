export interface LogEntry {
    level: number;
    time: number;
    pid: number;
    hostname: string;
    msg: string;
    module?: string;
    serverName?: string;
    toolName?: string;
    requestId?: string;
    err?: {
        message: string;
        stack?: string;
    };
    [key: string]: unknown;
}
export interface LogShipperConfig {
    instanceId: string;
    databaseUrl: string;
    minLevel: number;
    batchSize: number;
    flushIntervalMs: number;
    enabled: boolean;
}
export declare class LogShipper {
    private pgPool;
    private poolReady;
    private config;
    private buffer;
    private flushTimer;
    private shuttingDown;
    constructor(config?: Partial<LogShipperConfig>);
    private ensurePool;
    /** Start the log shipper */
    start(): Promise<void>;
    /** Stop the log shipper gracefully */
    stop(): Promise<void>;
    /**
     * Write a log entry to the buffer. This is the main method called
     * by the pino transport or log hooks.
     */
    write(entry: LogEntry): void;
    /**
     * Write a log entry synchronously (for pino stream compatibility).
     * Returns immediately — the log is buffered, not written synchronously.
     */
    writeSync(entry: string): void;
    /** Flush buffered logs to PostgreSQL */
    flush(): Promise<void>;
    /**
     * Create a pino transport stream object for use with pino's multistream.
     * Usage: pino({}, pino.multistream([...existingStreams, logShipper.createPinoStream()]))
     */
    createPinoStream(): {
        write: (chunk: string) => void;
    };
    /** Query recent logs from PG */
    queryLogs(options?: {
        instanceId?: string;
        level?: number;
        serverName?: string;
        limit?: number;
        offset?: number;
    }): Promise<any[]>;
    /** Get log count by level for dashboard stats */
    getLogStats(hoursBack?: number): Promise<{
        total: number;
        byLevel: Record<string, number>;
        byServer: Record<string, number>;
    }>;
}
//# sourceMappingURL=log-shipper.d.ts.map