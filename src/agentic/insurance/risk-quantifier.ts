/**
 * C4 — Cyber Insurance Risk Quantification (ALE modeling).
 */
import { randomUUID } from 'crypto';
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { ThreatPredictor } from '../threat-prediction/predictor.js';
import type { RiskScorer } from '../threat-prediction/risk-scorer.js';
import type { McpServerConfig } from '../../types.js';

export interface InsuranceRiskInput {
  tenantId?: string;
  serverName: string;
  toolCount: number;
  networkExposure: number;
  recordsAtRisk: number;
  avgRecordValueUsd?: number;
  knownCves?: number;
  maxCvss?: number;
}

export interface InsuranceRiskReport {
  id: string;
  serverName: string;
  aleUsd: number;
  exposureScore: number;
  exploitProbability: number;
  blastRadiusUsd: number;
  riskTier: 'low' | 'medium' | 'high' | 'critical';
  underwriterSummary: string;
  forecastConfidence?: number;
  fleetChainMultiplier?: number;
  ecosystemThreatHeat?: number;
  generatedAt: string;
}

export class InsuranceRiskQuantifier {
  constructor(
    private readonly predictor?: ThreatPredictor,
    private readonly riskScorer?: RiskScorer,
    private readonly store?: IndustryStandardStore,
  ) {}

  quantify(input: InsuranceRiskInput): InsuranceRiskReport {
    const serverConfig: McpServerConfig = {
      name: input.serverName,
      transport: input.networkExposure >= 0.5 ? 'sse' : 'stdio',
      packageName: input.serverName,
    };

    const riskScore = this.riskScorer?.scoreServer(
      serverConfig,
      input.knownCves ?? Math.round(input.networkExposure * 5),
      input.maxCvss ?? input.networkExposure * 8,
    );

    const forecast = riskScore && this.predictor
      ? this.predictor.forecast(riskScore, input.knownCves ?? 0)
      : undefined;

    const exploitProbabilityBase = forecast?.exploitationProbability
      ?? (0.02 + Math.min(0.58, input.networkExposure * 0.05 + input.toolCount * 0.01));

    const { fleetMultiplier, threatHeat } = this.readFleetEcosystemSignals();
    const exploitProbability = Math.min(0.95, exploitProbabilityBase * fleetMultiplier);

    const exposureScore = riskScore
      ? riskScore.overallScore / 100
      : Math.min(1, input.networkExposure * 0.3 + input.toolCount * 0.02);

    const recordValue = input.avgRecordValueUsd ?? 250;
    const blastRadiusUsd = input.recordsAtRisk * recordValue * exposureScore;
    const aleUsd = Math.round(blastRadiusUsd * exploitProbability);

    let riskTier: InsuranceRiskReport['riskTier'] = 'low';
    if (aleUsd >= 1_000_000) riskTier = 'critical';
    else if (aleUsd >= 250_000) riskTier = 'high';
    else if (aleUsd >= 50_000) riskTier = 'medium';

    const report: InsuranceRiskReport = {
      id: randomUUID(),
      serverName: input.serverName,
      aleUsd,
      exposureScore,
      exploitProbability,
      blastRadiusUsd,
      riskTier,
      forecastConfidence: forecast?.confidence,
      fleetChainMultiplier: fleetMultiplier,
      ecosystemThreatHeat: threatHeat,
      underwriterSummary: `Annualized loss expectancy $${aleUsd.toLocaleString()} for ${input.serverName} ` +
        `(${riskTier} tier). Exploit probability ${(exploitProbability * 100).toFixed(1)}%, ` +
        `blast radius $${Math.round(blastRadiusUsd).toLocaleString()}` +
        (fleetMultiplier > 1 ? `, fleet/ecosystem multiplier ×${fleetMultiplier.toFixed(2)}.` : '.') +
        (forecast ? ` 30d risk projection ${forecast.risk30d}/100.` : ''),
      generatedAt: new Date().toISOString(),
    };

    this.store?.saveInsuranceRiskReport?.({
      id: report.id,
      aleUsd: report.aleUsd,
      exposureScore: report.exposureScore,
      reportJson: JSON.stringify(report),
    }, input.tenantId);
    return report;
  }

  /** C4 — Incorporate A1 fleet chain alerts and B2 observatory threat heat. */
  private readFleetEcosystemSignals(): { fleetMultiplier: number; threatHeat: number } {
    const fleetAlerts = this.store?.listFleetChainAlerts?.(undefined, 100)?.length ?? 0;
    const metrics = this.store?.listObservatoryMetrics?.(200) ?? [];
    const heatSamples = metrics.filter(m => m.metricType === 'threat_heat').map(m => m.value);
    const threatHeat = heatSamples.length ? Math.max(...heatSamples) : 0;

    let fleetMultiplier = 1;
    if (fleetAlerts >= 5) fleetMultiplier += 0.2;
    else if (fleetAlerts >= 2) fleetMultiplier += 0.1;
    if (threatHeat >= 75) fleetMultiplier += 0.15;
    else if (threatHeat >= 50) fleetMultiplier += 0.08;

    return { fleetMultiplier, threatHeat };
  }
}
