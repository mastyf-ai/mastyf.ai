/** Manages all SIEM/observability exporters */
import { Logger } from '../utils/logger.js';
import { sendWithRetry, flushExporterDlq } from './exporter-dlq.js';
export class ExporterManager {
    config;
    exporters = [];
    constructor() {
        this.config = {
            splunk: {
                enabled: process.env['MASTYF_AI_SIEM_SPLUNK_ENABLED'] === 'true',
                hecUrl: process.env['MASTYF_AI_SIEM_SPLUNK_HEC_URL'] || '',
                hecToken: process.env['MASTYF_AI_SIEM_SPLUNK_HEC_TOKEN'] || '',
            },
            elastic: {
                enabled: process.env['MASTYF_AI_SIEM_ELASTIC_ENABLED'] === 'true',
                url: process.env['MASTYF_AI_SIEM_ELASTIC_URL'] || '',
                apiKey: process.env['MASTYF_AI_SIEM_ELASTIC_API_KEY'],
                username: process.env['MASTYF_AI_SIEM_ELASTIC_USERNAME'],
                password: process.env['MASTYF_AI_SIEM_ELASTIC_PASSWORD'],
            },
            datadog: {
                enabled: process.env['MASTYF_AI_SIEM_DATADOG_ENABLED'] === 'true',
                apiKey: process.env['MASTYF_AI_SIEM_DATADOG_API_KEY'] || '',
                site: process.env['MASTYF_AI_SIEM_DATADOG_SITE'] || 'datadoghq.com',
            },
            chronicle: {
                enabled: process.env['MASTYF_AI_SIEM_CHRONICLE_ENABLED'] === 'true',
                customerId: process.env['MASTYF_AI_SIEM_CHRONICLE_CUSTOMER_ID'] || '',
                serviceAccountKey: process.env['MASTYF_AI_SIEM_CHRONICLE_SA_KEY'] || '',
            },
            otel: {
                enabled: process.env['MASTYF_AI_SIEM_OTEL_ENABLED'] === 'true',
                endpoint: process.env['MASTYF_AI_SIEM_OTEL_ENDPOINT'] || 'http://localhost:4318/v1/logs',
            },
        };
    }
    async start() {
        this.exporters = [];
        let count = 0;
        if (this.config.splunk?.enabled) {
            if (!this.config.splunk.hecUrl || !this.config.splunk.hecToken) {
                Logger.warn('[ExporterManager] Splunk enabled but missing hecUrl or hecToken, skipping');
            }
            else {
                this.exporters.push({
                    name: 'splunk',
                    send: async (event) => {
                        await this.sendToSplunk(event);
                    },
                });
                count++;
            } // end else (credentials present)
        }
        if (this.config.elastic?.enabled) {
            this.exporters.push({
                name: 'elastic',
                send: async (event) => {
                    await this.sendToElastic(event);
                },
            });
            count++;
        }
        if (this.config.datadog?.enabled) {
            this.exporters.push({
                name: 'datadog',
                send: async (event) => {
                    await this.sendToDatadog(event);
                },
            });
            count++;
        }
        if (this.config.chronicle?.enabled) {
            this.exporters.push({
                name: 'chronicle',
                send: async (event) => {
                    await this.sendToChronicle(event);
                },
            });
            count++;
        }
        if (this.config.otel?.enabled) {
            this.exporters.push({
                name: 'otel',
                send: async (event) => {
                    await this.sendToOtel(event);
                },
            });
            count++;
        }
        Logger.info(`[ExporterManager] Started with ${count} exporters`);
        if (process.env['MASTYF_AI_EXPORTER_DLQ_FLUSH'] !== 'false') {
            void this.flushDlq();
        }
    }
    async export(event) {
        await Promise.allSettled(this.exporters.map((e) => sendWithRetry(e.name, () => e.send(event), event)));
    }
    async flushDlq() {
        const senders = {};
        for (const e of this.exporters) {
            senders[e.name] = (ev) => e.send(ev);
        }
        return flushExporterDlq(senders);
    }
    async sendToSplunk(event) {
        const cfg = this.config.splunk;
        try {
            const response = await fetch(`${cfg.hecUrl}/services/collector/event`, {
                method: 'POST',
                headers: {
                    'Authorization': `Splunk ${cfg.hecToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    time: Date.now() / 1000,
                    host: process.env['HOSTNAME'] || 'unknown',
                    source: 'mastyf-ai',
                    sourcetype: '_json',
                    index: cfg.index || 'main',
                    event,
                }),
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        }
        catch (err) {
            throw err instanceof Error ? err : new Error(String(err));
        }
    }
    async sendToElastic(event) {
        const cfg = this.config.elastic;
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (cfg.apiKey)
                headers['Authorization'] = `ApiKey ${cfg.apiKey}`;
            else if (cfg.username) {
                headers['Authorization'] = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password || ''}`).toString('base64');
            }
            const res = await fetch(`${cfg.url}/mastyf-ai-${new Date().toISOString().split('T')[0]}/_doc`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ '@timestamp': event.timestamp, ...event }),
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
        }
        catch (err) {
            throw err instanceof Error ? err : new Error(String(err));
        }
    }
    async sendToDatadog(event) {
        const cfg = this.config.datadog;
        try {
            const res = await fetch(`https://http-intake.logs.${cfg.site}/v1/input`, {
                method: 'POST',
                headers: {
                    'DD-API-KEY': cfg.apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ddsource: 'mastyf-ai',
                    ddtags: `instance:${process.env['MASTYF_AI_INSTANCE_ID'] || 'default'}`,
                    hostname: process.env['HOSTNAME'] || 'unknown',
                    service: 'mastyf-ai',
                    message: JSON.stringify(event.payload),
                    ...event,
                }),
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
        }
        catch (err) {
            throw err instanceof Error ? err : new Error(String(err));
        }
    }
    async sendToChronicle(event) {
        try {
            // Chronicle Ingestion API expects UDM format
            const res = await fetch('https://chronicle.googleapis.com/v1alpha/ingestion/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer_id: this.config.chronicle.customerId,
                    events: [{
                            metadata: {
                                event_timestamp: new Date(event.timestamp).toISOString(),
                                event_type: 'MASTYF_AI_EVENT',
                            },
                            additional: event.payload,
                        }],
                }),
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
        }
        catch (err) {
            throw err instanceof Error ? err : new Error(String(err));
        }
    }
    async sendToOtel(event) {
        try {
            const res = await fetch(this.config.otel.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    resourceLogs: [{
                            resource: {
                                attributes: [
                                    { key: 'service.name', value: { stringValue: 'mastyf-ai' } },
                                ],
                            },
                            scopeLogs: [{
                                    logRecords: [{
                                            timeUnixNano: String(Date.now() * 1_000_000),
                                            severityNumber: 9,
                                            body: { stringValue: JSON.stringify(event) },
                                        }],
                                }],
                        }],
                }),
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
        }
        catch (err) {
            throw err instanceof Error ? err : new Error(String(err));
        }
    }
}
//# sourceMappingURL=exporter-manager.js.map