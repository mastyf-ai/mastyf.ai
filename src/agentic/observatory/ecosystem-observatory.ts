/**
 * B2 — MCP Ecosystem Health Observatory (aggregated anonymized telemetry).
 */
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import {
  mergeCloudIntoSnapshot,
  type CloudObservatoryPayload,
} from './observatory-cloud-relay.js';

export interface ObservatoryMetric {
  metricType: string;
  value: number;
  dimension?: Record<string, unknown>;
  recordedAt: string;
}

export interface ObservatorySnapshot {
  adoptionScore: number;
  threatHeatIndex: number;
  avgBlockRate: number;
  serverCount: number;
  topThreatClasses: Array<{ cls: string; count: number }>;
  generatedAt: string;
  trends?: {
    blockRateDelta: number;
    serverCountDelta: number;
    threatHeatDelta: number;
  };
}

export interface ObservatoryAlert {
  alertType: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metricType?: string;
  threshold?: number;
  observedValue?: number;
  createdAt: string;
}

const BLOCK_RATE_WARN = parseFloat(process.env.GUARDIAN_OBSERVATORY_BLOCK_RATE_WARN ?? '0.85');
const THREAT_HEAT_WARN = parseFloat(process.env.GUARDIAN_OBSERVATORY_THREAT_HEAT_WARN ?? '50');

export class EcosystemObservatory {
  private memoryMetrics: ObservatoryMetric[] = [];
  private lastSnapshot: ObservatorySnapshot | null = null;

  constructor(private readonly store?: IndustryStandardStore) {}

  recordMetric(metricType: string, value: number, dimension?: Record<string, unknown>): void {
    const metric: ObservatoryMetric = {
      metricType,
      value,
      dimension,
      recordedAt: new Date().toISOString(),
    };
    this.memoryMetrics.push(metric);
    if (this.memoryMetrics.length > 1000) this.memoryMetrics.splice(0, this.memoryMetrics.length - 1000);
    this.store?.saveObservatoryMetric?.({ metricType, value, dimension });
  }

  ingestBenchmarkSubmission(params: {
    blockRate: number;
    falsePositiveRate: number;
    serverCount: number;
    threatClasses?: Record<string, number>;
  }): void {
    this.recordMetric('block_rate', params.blockRate);
    this.recordMetric('false_positive_rate', params.falsePositiveRate);
    this.recordMetric('server_count', params.serverCount);
    for (const [cls, count] of Object.entries(params.threatClasses ?? {})) {
      this.recordMetric('threat_class', count, { class: cls });
    }
  }

  snapshot(): ObservatorySnapshot {
    const storeMetrics = this.store?.listObservatoryMetrics?.(500) ?? [];
    const metrics = [
      ...this.memoryMetrics.map(m => ({
        metricType: m.metricType,
        value: m.value,
        dimension: m.dimension,
        recordedAt: m.recordedAt,
      })),
      ...storeMetrics,
    ];
    const blockRates = metrics.filter(m => m.metricType === 'block_rate').map(m => m.value);
    const serverCounts = metrics.filter(m => m.metricType === 'server_count').map(m => m.value);
    const threatClasses = metrics.filter(m => m.metricType === 'threat_class');

    const avgBlockRate = blockRates.length
      ? blockRates.reduce((a, b) => a + b, 0) / blockRates.length
      : 0;
    const serverCount = serverCounts.length ? Math.max(...serverCounts) : 0;

    const classMap = new Map<string, number>();
    for (const m of threatClasses) {
      const cls = String(m.dimension?.class ?? 'unknown');
      classMap.set(cls, (classMap.get(cls) ?? 0) + m.value);
    }
    const topThreatClasses = [...classMap.entries()]
      .map(([cls, count]) => ({ cls, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const threatHeatIndex = Math.min(100, topThreatClasses.reduce((s, t) => s + t.count, 0));
    const adoptionScore = Math.min(100, serverCount * 5 + metrics.length);

    const snap: ObservatorySnapshot = {
      adoptionScore,
      threatHeatIndex,
      avgBlockRate,
      serverCount,
      topThreatClasses,
      generatedAt: new Date().toISOString(),
    };

    if (this.lastSnapshot) {
      snap.trends = {
        blockRateDelta: avgBlockRate - this.lastSnapshot.avgBlockRate,
        serverCountDelta: serverCount - this.lastSnapshot.serverCount,
        threatHeatDelta: threatHeatIndex - this.lastSnapshot.threatHeatIndex,
      };
    }
    this.lastSnapshot = snap;
    return snap;
  }

  /** Proactive threshold alerts (B2). */
  evaluateProactiveAlerts(): ObservatoryAlert[] {
    const snap = this.snapshot();
    const alerts: ObservatoryAlert[] = [];
    const now = new Date().toISOString();

    if (snap.avgBlockRate > 0 && snap.avgBlockRate < BLOCK_RATE_WARN) {
      const alert: ObservatoryAlert = {
        alertType: 'low_block_rate',
        severity: 'warning',
        message: `Fleet block rate ${(snap.avgBlockRate * 100).toFixed(1)}% below threshold ${(BLOCK_RATE_WARN * 100).toFixed(0)}%`,
        metricType: 'block_rate',
        threshold: BLOCK_RATE_WARN,
        observedValue: snap.avgBlockRate,
        createdAt: now,
      };
      alerts.push(alert);
      this.store?.saveObservatoryAlert?.(alert);
    }

    if (snap.threatHeatIndex >= THREAT_HEAT_WARN) {
      const top = snap.topThreatClasses[0];
      const alert: ObservatoryAlert = {
        alertType: 'threat_heat_elevated',
        severity: snap.threatHeatIndex >= THREAT_HEAT_WARN * 1.5 ? 'critical' : 'warning',
        message: top
          ? `Threat heat index ${snap.threatHeatIndex.toFixed(0)} — top class: ${top.cls} (${top.count})`
          : `Threat heat index ${snap.threatHeatIndex.toFixed(0)} exceeds threshold`,
        metricType: 'threat_heat',
        threshold: THREAT_HEAT_WARN,
        observedValue: snap.threatHeatIndex,
        createdAt: now,
      };
      alerts.push(alert);
      this.store?.saveObservatoryAlert?.(alert);
    }

    if (snap.trends && snap.trends.threatHeatDelta > 15) {
      const alert: ObservatoryAlert = {
        alertType: 'threat_spike',
        severity: 'critical',
        message: `Threat heat spiked +${snap.trends.threatHeatDelta.toFixed(0)} since last snapshot`,
        metricType: 'threat_heat_delta',
        observedValue: snap.trends.threatHeatDelta,
        createdAt: now,
      };
      alerts.push(alert);
      this.store?.saveObservatoryAlert?.(alert);
    }

    return alerts;
  }

  listAlerts(limit = 50): ObservatoryAlert[] {
    const persisted = this.store?.listObservatoryAlerts?.(limit) ?? [];
    return persisted.map(p => ({
      alertType: p.alertType,
      severity: p.severity as ObservatoryAlert['severity'],
      message: p.message,
      metricType: p.metricType,
      threshold: p.threshold,
      observedValue: p.observedValue,
      createdAt: p.createdAt,
    }));
  }

  /** Ingest metrics from Guardian Cloud observatory relay (B2). */
  ingestCloudMetrics(metrics: Array<{ metricType: string; value: number; dimension?: Record<string, unknown> }>): number {
    let ingested = 0;
    for (const m of metrics) {
      this.recordMetric(m.metricType, m.value, m.dimension);
      ingested++;
    }
    return ingested;
  }

  /** Snapshot merged with optional cloud overlay. */
  snapshotWithCloud(cloud?: CloudObservatoryPayload): ObservatorySnapshot {
    const local = this.snapshot();
    if (!cloud) return local;
    return mergeCloudIntoSnapshot(local, cloud);
  }
}
