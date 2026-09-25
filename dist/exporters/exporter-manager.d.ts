export interface ExporterConfig {
    splunk?: {
        enabled: boolean;
        hecUrl: string;
        hecToken: string;
        index?: string;
    };
    elastic?: {
        enabled: boolean;
        url: string;
        apiKey?: string;
        username?: string;
        password?: string;
    };
    datadog?: {
        enabled: boolean;
        apiKey: string;
        site?: string;
    };
    chronicle?: {
        enabled: boolean;
        customerId: string;
        serviceAccountKey: string;
    };
    otel?: {
        enabled: boolean;
        endpoint: string;
    };
}
export declare class ExporterManager {
    private config;
    private exporters;
    constructor();
    start(): Promise<void>;
    export(event: {
        type: string;
        payload: any;
        timestamp: string;
    }): Promise<void>;
    flushDlq(): Promise<number>;
    private sendToSplunk;
    private sendToElastic;
    private sendToDatadog;
    private sendToChronicle;
    private sendToOtel;
}
//# sourceMappingURL=exporter-manager.d.ts.map