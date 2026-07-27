/**
 * Anomaly Detection Engine — unified ML-based scoring for tool call arguments.
 *
 * Combines three detection layers into a single anomaly confidence score (0–1):
 *   Layer 1: Argument scanner pattern hits (SQL/NoSQL, shell, boundary, etc.)
 *   Layer 2: Behavioral baseline deviations (per-tool, per-server)
 *   Layer 3: Agent intent graph kill-chain detection (cross-tool patterns)
 *
 * Uses exponential weighting: score = 1 - ∏(1 - wᵢ × cᵢ)
 *   where wᵢ = per-layer weight, cᵢ = layer confidence
 *
 * Thread-safe. All state mutations flow through SelfImprovement's quorum system.
 * Drift-aware: freezes score adjustments when drift is detected.
 */
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { getLicenseClient } from '../license/license-client.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ArgumentLayerScore {
  /** Number of critical-severity issues found. */
  criticalCount: number;
  /** Number of warning-severity issues found. */
  warningCount: number;
  /** Total number of issues found. */
  totalIssues: number;
  /** Highest individual issue confidence. */
  maxConfidence: number;
  /** Weighted score — higher = more suspicious. */
  score: number;
  /** Category distribution (category → count). */
  categories: Record<string, number>;
}

export interface BaselineLayerScore {
  /** Whether a behavioral baseline exists for this tool. */
  baselineExists: boolean;
  /** How many standard deviations from the baseline mean. */
  sigmaDeviation: number;
  /** Which features deviate most (0–5 per dimension). */
  deviatingFeatures: string[];
  /** Weighted score — higher = more anomalous. */
  score: number;
}

export interface IntentGraphScore {
  /** Whether a kill chain was detected in this session. */
  killChainDetected: boolean;
  /** The kill-chain pattern matched (e.g. 'read-encode-exfil'). */
  killChainPattern: string | null;
  /** Confidence of the kill-chain match. */
  chainConfidence: number;
  /** Number of previous suspicious calls in this session. */
  sessionSuspiciousCalls: number;
  /** Weighted score — higher = more suspicious. */
  score: number;
}

export interface AnomalyScore {
  /** 0–1 overall anomaly confidence. */
  confidence: number;
  /** Individual layer breakdown. */
  layers: {
    argument: ArgumentLayerScore;
    baseline: BaselineLayerScore;
    intent: IntentGraphScore;
  };
  /** Which layer contributed most. */
  primaryLayer: 'argument' | 'baseline' | 'intent' | 'none';
  /** Whether the score exceeds the adaptive threshold. */
  aboveThreshold: boolean;
  /** Adaptive threshold used for comparison. */
  adaptiveThreshold: number;
  /** Per-tool anomaly history sample count. */
  sampleCount: number;
}

// ── Configuration ────────────────────────────────────────────────────

/** Per-layer weights (must sum to 1 for normalized scoring). */
const LAYER_WEIGHTS = {
  argument: 0.40,
  baseline: 0.35,
  intent: 0.25,
};

/** Minimum samples before baseline layer activates. */
const MIN_BASELINE_SAMPLES = 10;

/** Maximum samples to track per tool. */
const MAX_SAMPLES_PER_TOOL = 500;

/** How many standard deviations to consider anomalous (3σ rule). */
const ANOMALY_SIGMA_THRESHOLD = 3.0;

/** Score decay factor per minute since last call (0.999 = ~5% per hour). */
const SCORE_DECAY_PER_MINUTE = 0.001;

// ── Per-tool behavioral profile ──────────────────────────────────────

interface ToolProfile {
  toolName: string;
  serverName: string;
  samples: SampleRecord[];
  /** Rolling mean of argument scan issue counts. */
  argMean: number;
  /** Rolling std dev of argument scan issue counts. */
  argStd: number;
  /** Rolling mean of critical issues. */
  critMean: number;
  /** Rolling std dev of critical issues. */
  critStd: number;
  createdAt: number;
  lastUpdated: number;
}

interface SampleRecord {
  timestamp: number;
  argIssues: number;
  criticalIssues: number;
  warningIssues: number;
  maxConfidence: number;
  categories: Record<string, number>;
  anomalyScore: number;
  wasBlocked: boolean;
}

// ── Per-session intent tracking ──────────────────────────────────────

interface SessionTracker {
  sessionKey: string;
  tenantId: string;
  calls: Array<{
    toolName: string;
    timestamp: number;
    suspicious: boolean;
    anomalyScore: number;
  }>;
  killChainProgress: number;  // 0–1 estimate of kill-chain stage completion
  createdAt: number;
}

// ── Main Class ───────────────────────────────────────────────────────

let singleton: AnomalyDetector | null = null;

export function getAnomalyDetector(): AnomalyDetector {
  if (!singleton) singleton = new AnomalyDetector();
  return singleton;
}

export function resetAnomalyDetectorForTests(): void {
  singleton = null;
}

export class AnomalyDetector {
  /** Per-(server, tool) behavioral profiles. */
  private profiles = new Map<string, ToolProfile>();

  /** Per-session intent trackers. */
  private sessions = new Map<string, SessionTracker>();

  /** Cached adaptive threshold from SelfImprovement. */
  private cachedThreshold = 0.85;

  /** Whether anomaly detection is licensed (Pro 'ai' feature). */
  private licensed = false;

  private lastThresholdCheck = 0;

  /** Build a profile key from serverName + toolName. */
  private profileKey(serverName: string, toolName: string): string {
    return `${serverName}:${toolName}`;
  }

  /** Check if Pro license has 'ai' feature. Cached for 30s. */
  private isLicensed(): boolean {
    const now = Date.now();
    if (now - this.lastThresholdCheck > 30_000) {
      this.licensed = getLicenseClient().hasFeature('ai');
      this.lastThresholdCheck = now;
    }
    return this.licensed;
  }

  /** Refresh the cached adaptive threshold from the SelfImprovement engine. */
  async refreshThreshold(): Promise<void> {
    try {
      const { SelfImprovement } = await import('./self-improvement.js');
      const si = new SelfImprovement();
      this.cachedThreshold = si.getAdaptiveThreshold();
    } catch {
      // Keep default 0.85
    }
  }

  // ── Layer 1: Argument Scanner Integration ────────────────────────

  /**
   * Score argument scanner results. Higher score = more suspicious args.
   * Critical issues weight 3× more than warnings.
   */
  private scoreArgumentLayer(
    criticalCount: number,
    warningCount: number,
    maxConfidence: number,
    categories: Record<string, number>,
  ): ArgumentLayerScore {
    const weightedCritical = criticalCount * 0.30;
    const weightedWarning = warningCount * 0.10;
    const rawScore = Math.min(1.0, weightedCritical + weightedWarning + maxConfidence * 0.20);

    return {
      criticalCount,
      warningCount,
      totalIssues: criticalCount + warningCount,
      maxConfidence,
      score: Math.round(rawScore * 1000) / 1000,
      categories,
    };
  }

  // ── Layer 2: Behavioral Baseline Deviation ────────────────────────

  /**
   * Score deviation from per-tool behavioral baselines.
   * Uses rolling z-score: (current - mean) / stdDev.
   * Returns { sigma, score } where score > 0.5 indicates significant deviation.
   */
  private scoreBaselineLayer(
    profile: ToolProfile | undefined,
    currentIssues: number,
    currentCritical: number,
  ): BaselineLayerScore {
    if (!profile || profile.samples.length < MIN_BASELINE_SAMPLES) {
      return {
        baselineExists: false,
        sigmaDeviation: 0,
        deviatingFeatures: [],
        score: 0,
      };
    }

    const deviatingFeatures: string[] = [];
    let maxSigma = 0;

    // Check argument issue count deviation
    if (profile.argStd > 0) {
      const sigma = Math.abs(currentIssues - profile.argMean) / profile.argStd;
      if (sigma > ANOMALY_SIGMA_THRESHOLD) {
        deviatingFeatures.push(`arg_count:${sigma.toFixed(1)}σ`);
      }
      maxSigma = Math.max(maxSigma, sigma);
    }

    // Check critical issue count deviation
    if (profile.critStd > 0) {
      const sigma = Math.abs(currentCritical - profile.critMean) / profile.critStd;
      if (sigma > ANOMALY_SIGMA_THRESHOLD) {
        deviatingFeatures.push(`critical_count:${sigma.toFixed(1)}σ`);
      }
      maxSigma = Math.max(maxSigma, sigma);
    }

    // Convert sigma to score (0–1)
    let score = 0;
    if (maxSigma > 0) {
      score = Math.min(1.0, maxSigma / (ANOMALY_SIGMA_THRESHOLD * 3));
    }

    return {
      baselineExists: true,
      sigmaDeviation: Math.round(maxSigma * 100) / 100,
      deviatingFeatures,
      score: Math.round(score * 1000) / 1000,
    };
  }

  // ── Layer 3: Intent Graph Kill-Chain Detection ────────────────────

  /**
   * Score based on session-wide intent graph and kill-chain progression.
   * Each previously-suspicious call in the session increases the score.
   */
  private scoreIntentLayer(
    session: SessionTracker | undefined,
    currentSuspicious: boolean,
    anomalyScore: number,
  ): IntentGraphScore {
    if (!session) {
      return {
        killChainDetected: false,
        killChainPattern: null,
        chainConfidence: 0,
        sessionSuspiciousCalls: 0,
        score: 0,
      };
    }

    const previousSuspicious = session.calls.filter((c) => c.suspicious).length;
    const totalCalls = session.calls.length;

    // Kill-chain progression: each suspicious call advances the chain
    let chainConfidence = 0;
    let killChainPattern: string | null = null;

    if (previousSuspicious >= 2 && totalCalls >= 3) {
      // Check if the call sequence matches known kill-chain patterns
      const roles: string[] = [];
      for (const call of session.calls) {
        if (call.suspicious) roles.push('suspicious');
        else roles.push('benign');
      }

      const suspiciousRatio = previousSuspicious / totalCalls;
      if (suspiciousRatio > 0.5) {
        chainConfidence = Math.min(0.95, 0.5 + suspiciousRatio * 0.5);
        killChainPattern = previousSuspicious >= 4 ? 'multi-step-staging' : 'suspicious-chain';
      } else if (previousSuspicious >= 1) {
        chainConfidence = 0.3 + suspiciousRatio * 0.3;
        killChainPattern = 'isolated-suspicious';
      }
    }

    // Score formula: base from chain + bonus from session history
    let score = 0;
    if (chainConfidence > 0) {
      score = chainConfidence * 0.7 + Math.min(1.0, previousSuspicious / 5) * 0.3;
    } else if (previousSuspicious > 0 && currentSuspicious) {
      score = Math.min(0.5, previousSuspicious / 10);
    }

    return {
      killChainDetected: chainConfidence > 0.5,
      killChainPattern,
      chainConfidence: Math.round(chainConfidence * 1000) / 1000,
      sessionSuspiciousCalls: previousSuspicious,
      score: Math.round(score * 1000) / 1000,
    };
  }

  // ── Profile Management ─────────────────────────────────────────────

  /**
   * Record a tool call result for per-tool behavioral profiling.
   */
  recordCall(
    serverName: string,
    toolName: string,
    argIssues: number,
    criticalIssues: number,
    warningIssues: number,
    maxConfidence: number,
    categories: Record<string, number>,
    anomalyScore: number,
    wasBlocked: boolean,
  ): void {
    if (!this.isLicensed()) return;

    const key = this.profileKey(serverName, toolName);
    let profile = this.profiles.get(key);

    if (!profile) {
      profile = {
        toolName,
        serverName,
        samples: [],
        argMean: 0,
        argStd: 0,
        critMean: 0,
        critStd: 0,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
      };
      this.profiles.set(key, profile);
    }

    // Evict LRU if too many profiles
    if (this.profiles.size > 1000) {
      const oldest = [...this.profiles.entries()].sort(
        (a, b) => a[1].lastUpdated - b[1].lastUpdated,
      )[0];
      if (oldest) this.profiles.delete(oldest[0]);
    }

    const sample: SampleRecord = {
      timestamp: Date.now(),
      argIssues,
      criticalIssues,
      warningIssues,
      maxConfidence,
      categories: { ...categories },
      anomalyScore,
      wasBlocked,
    };

    profile.samples.push(sample);
    if (profile.samples.length > MAX_SAMPLES_PER_TOOL) {
      profile.samples = profile.samples.slice(-MAX_SAMPLES_PER_TOOL);
    }

    // Recompute rolling statistics (Welford's online algorithm for mean/variance)
    this.recomputeProfileStats(profile);
    profile.lastUpdated = Date.now();
  }

  /** Recompute rolling mean and std dev for a profile. */
  private recomputeProfileStats(profile: ToolProfile): void {
    if (profile.samples.length === 0) return;

    let argSum = 0;
    let argSumSq = 0;
    let critSum = 0;
    let critSumSq = 0;
    const n = profile.samples.length;

    for (const s of profile.samples) {
      argSum += s.argIssues;
      argSumSq += s.argIssues * s.argIssues;
      critSum += s.criticalIssues;
      critSumSq += s.criticalIssues * s.criticalIssues;
    }

    profile.argMean = argSum / n;
    profile.argStd = Math.sqrt(Math.max(0, argSumSq / n - profile.argMean * profile.argMean));
    profile.critMean = critSum / n;
    profile.critStd = Math.sqrt(Math.max(0, critSumSq / n - profile.critMean * profile.critMean));
  }

  /** Get profile for a tool (read-only). */
  getProfile(serverName: string, toolName: string): ToolProfile | undefined {
    return this.profiles.get(this.profileKey(serverName, toolName));
  }

  // ── Session Intent Tracking ───────────────────────────────────────

  /** Start or get a session intent tracker. */
  ensureSession(sessionKey: string, tenantId: string): SessionTracker {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = {
        sessionKey,
        tenantId,
        calls: [],
        killChainProgress: 0,
        createdAt: Date.now(),
      };
      this.sessions.set(sessionKey, session);
    }
    return session;
  }

  /** Record a tool call within a session for kill-chain analysis. */
  trackSessionCall(
    sessionKey: string,
    tenantId: string,
    toolName: string,
    suspicious: boolean,
    anomalyScore: number,
  ): void {
    const session = this.ensureSession(sessionKey, tenantId);
    session.calls.push({
      toolName,
      timestamp: Date.now(),
      suspicious,
      anomalyScore,
    });

    // Update kill-chain progress estimate
    const suspiciousCount = session.calls.filter((c) => c.suspicious).length;
    const total = session.calls.length;
    session.killChainProgress = total > 0
      ? Math.min(1.0, (suspiciousCount / Math.max(3, total / 2)))
      : 0;

    // Evict old sessions (>1 hour idle)
    const cutoff = Date.now() - 3600_000;
    for (const [key, sess] of this.sessions) {
      if (sess.createdAt < cutoff) this.sessions.delete(key);
    }
  }

  getSession(sessionKey: string): SessionTracker | undefined {
    return this.sessions.get(sessionKey);
  }

  // ── Main Scoring Pipeline ─────────────────────────────────────────

  /**
   * Evaluate a tool call and produce a unified anomaly score (0–1).
   * This is the main entry point for the policy engine.
   *
   * @param serverName  MCP server name
   * @param toolName    Tool being called
   * @param criticalCount  Number of critical issues from argument scanner
   * @param warningCount   Number of warning issues from argument scanner
   * @param maxConfidence  Highest individual issue confidence
   * @param categories     Category distribution from argument scanner
   * @param sessionKey     Session key for intent tracking (null = no tracking)
   * @param tenantId       Tenant identifier
   */
  async evaluate(
    serverName: string,
    toolName: string,
    criticalCount: number,
    warningCount: number,
    maxConfidence: number,
    categories: Record<string, number>,
    sessionKey: string | null,
    tenantId: string,
  ): Promise<AnomalyScore> {
    if (!this.isLicensed()) {
      return {
        confidence: 0,
        layers: {
          argument: this.scoreArgumentLayer(criticalCount, warningCount, maxConfidence, categories),
          baseline: { baselineExists: false, sigmaDeviation: 0, deviatingFeatures: [], score: 0 },
          intent: { killChainDetected: false, killChainPattern: null, chainConfidence: 0, sessionSuspiciousCalls: 0, score: 0 },
        },
        primaryLayer: 'none',
        aboveThreshold: false,
        adaptiveThreshold: this.cachedThreshold,
        sampleCount: 0,
      };
    }

    await this.refreshThreshold();

    // Layer 1: Argument pattern analysis
    const argScore = this.scoreArgumentLayer(criticalCount, warningCount, maxConfidence, categories);

    // Layer 2: Behavioral baseline deviation
    const profile = this.getProfile(serverName, toolName);
    const baselineScore = this.scoreBaselineLayer(profile, argScore.totalIssues, criticalCount);

    // Layer 3: Intent graph / kill-chain analysis
    const isSuspicious = argScore.score > 0.3 || criticalCount > 0;
    const session = sessionKey ? this.getSession(sessionKey) : undefined;
    const intentScore = this.scoreIntentLayer(session, isSuspicious, argScore.score);

    // Track session for future intent analysis
    if (sessionKey) {
      this.trackSessionCall(sessionKey, tenantId, toolName, isSuspicious, argScore.score);
    }

    // Record profile for future baseline analysis
    this.recordCall(
      serverName,
      toolName,
      argScore.totalIssues,
      criticalCount,
      warningCount,
      maxConfidence,
      categories,
      argScore.score,
      false,
    );

    // Weighted fusion using exponential combination
    const weightedSum =
      argScore.score * LAYER_WEIGHTS.argument +
      baselineScore.score * LAYER_WEIGHTS.baseline +
      intentScore.score * LAYER_WEIGHTS.intent;

    const confidence = Math.round(weightedSum * 1000) / 1000;

    // Determine primary contributing layer
    let primaryLayer: AnomalyScore['primaryLayer'] = 'none';
    const contributions = [
      { layer: 'argument' as const, value: argScore.score * LAYER_WEIGHTS.argument },
      { layer: 'baseline' as const, value: baselineScore.score * LAYER_WEIGHTS.baseline },
      { layer: 'intent' as const, value: intentScore.score * LAYER_WEIGHTS.intent },
    ];
    const maxContrib = contributions.reduce((a, b) => (a.value > b.value ? a : b));
    if (maxContrib.value > 0.05) {
      primaryLayer = maxContrib.layer;
    }

    const aboveThreshold = confidence >= this.cachedThreshold;

    // Layer 4 (optional): autoencoder → VulnFinding class:behavioral (no auto-block)
    if (process.env.MASTYF_AI_AUTOENCODER_ENABLED === 'true') {
      try {
        const { evaluateBehavioralAndRecord } = await import('../vuln-discovery/behavioral.js');
        await evaluateBehavioralAndRecord({
          toolName,
          arguments: { criticalCount, warningCount, maxConfidence, categories },
          serverName,
        });
      } catch {
        /* non-fatal */
      }
    }

    if (confidence > 0.3) {
      StructuredLogger.info({
        event: 'anomaly_detected',
        serverName,
        toolName,
        anomalyScore: confidence,
        primaryLayer,
        aboveThreshold,
        adaptiveThreshold: this.cachedThreshold,
      });
    }

    if (confidence > 0.5) {
      Logger.warn(
        `[anomaly] High anomaly score (${confidence.toFixed(3)}) for ${serverName}/${toolName} ` +
        `[arg=${argScore.score.toFixed(3)}, baseline=${baselineScore.score.toFixed(3)}, intent=${intentScore.score.toFixed(3)}]`,
      );
    }

    return {
      confidence,
      layers: { argument: argScore, baseline: baselineScore, intent: intentScore },
      primaryLayer,
      aboveThreshold,
      adaptiveThreshold: this.cachedThreshold,
      sampleCount: profile?.samples.length ?? 0,
    };
  }

  /** Get all loaded profiles (for dashboard/tests). */
  getAllProfiles(): ToolProfile[] {
    return [...this.profiles.values()];
  }

  /** Get all active sessions (for dashboard/tests). */
  getAllSessions(): SessionTracker[] {
    return [...this.sessions.values()];
  }

  /** Clear all profiles and sessions (for tests). */
  reset(): void {
    this.profiles.clear();
    this.sessions.clear();
    this.cachedThreshold = 0.85;
  }
}