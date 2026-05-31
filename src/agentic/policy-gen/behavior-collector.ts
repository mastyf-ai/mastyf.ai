/**
 * Behavior Collector — hooks into the proxy to observe tool call patterns.
 *
 * Collects (in a privacy-preserving manner):
 *   - Tool names called
 *   - Argument names and value types/ranges (not raw values)
 *   - Call frequency per tool
 *   - Tool co-occurrence (which tools are called together in sequence)
 *   - Response latency and error rates
 *
 * This data feeds the Policy Synthesizer to generate minimal-privilege YAML policies.
 */

import { Logger } from '../../utils/logger.js';

export interface ToolCallObservation {
  /** Tool name (e.g., "read_file", "execute_command") */
  toolName: string;
  /** Server name the tool belongs to */
  serverName: string;
  /** Argument keys observed */
  argumentKeys: string[];
  /** Argument value types (e.g., "string", "number", "boolean", "object", "array") */
  argumentTypes: Record<string, string>;
  /** Arg value length stats (min, max for strings; min, max for numbers) */
  argumentRanges: Record<string, { min?: number; max?: number; avg?: number }>;
  /** Unix timestamp of the call */
  timestamp: number;
  /** Response latency in ms */
  latencyMs: number;
  /** Whether the call succeeded */
  success: boolean;
  /** A short hash of the session/context for co-occurrence analysis */
  sessionHash: string;
  /** Agent id for biometric vector correlation (A3) */
  agentId?: string;
  /** Credential identity for mismatch detection */
  credentialIdentity?: string;
}

export interface ObservationWindow {
  /** Unique window id */
  windowId: string;
  /** When collection started */
  startedAt: string;
  /** Whether collection is complete */
  complete: boolean;
  /** Total calls observed */
  totalCalls: number;
  /** Unique tools observed */
  uniqueTools: number;
  /** Observations grouped by tool */
  byTool: Record<string, ToolCallObservation[]>;
  /** Co-occurrence matrix: toolA -> toolB -> count */
  coOccurrences: Record<string, Record<string, number>>;
  /** Session sequences (ordered tool calls per session) */
  sessionSequences: Record<string, string[]>;
  /** Aggregate statistics */
  stats: WindowStatistics;
}

export interface WindowStatistics {
  totalObservations: number;
  uniqueTools: string[];
  toolCallCounts: Record<string, number>;
  toolLatencyP50: Record<string, number>;
  toolLatencyP95: Record<string, number>;
  toolErrorRate: Record<string, number>;
  argumentKeysByTool: Record<string, string[]>;
  argumentTypesByTool: Record<string, Record<string, string>>;
  /** Most common tool sequences (length-2 and length-3) */
  commonSequences: { sequence: string[]; count: number }[];
}

export class BehaviorCollector {
  private active = false;
  private currentWindow: ObservationWindow | null = null;
  private windowHistory: ObservationWindow[] = [];
  private fingerprintEngine: import('../biometrics/behavior-fingerprint.js').BehaviorFingerprintEngine | null = null;

  /** Wire A3 biometric fingerprint engine for vector correlation. */
  setFingerprintEngine(engine: import('../biometrics/behavior-fingerprint.js').BehaviorFingerprintEngine): void {
    this.fingerprintEngine = engine;
  }

  /**
   * Start a new observation window. If a window is already active,
   * it is finalized first.
   */
  startWindow(windowId?: string): ObservationWindow {
    if (this.active && this.currentWindow) {
      this.finalizeWindow();
    }

    this.active = true;
    this.currentWindow = {
      windowId: windowId || crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      complete: false,
      totalCalls: 0,
      uniqueTools: 0,
      byTool: {},
      coOccurrences: {},
      sessionSequences: {},
      stats: {
        totalObservations: 0,
        uniqueTools: [],
        toolCallCounts: {},
        toolLatencyP50: {},
        toolLatencyP95: {},
        toolErrorRate: {},
        argumentKeysByTool: {},
        argumentTypesByTool: {},
        commonSequences: [],
      },
    };

    Logger.info(`[BehaviorCollector] Started observation window: ${this.currentWindow.windowId}`);
    return this.currentWindow;
  }

  /**
   * Record a tool call observation. Called by the proxy on every tools/call.
   */
  record(observation: ToolCallObservation): void {
    if (!this.active || !this.currentWindow) return;

    if (this.fingerprintEngine && observation.agentId) {
      const argBytes = Object.values(observation.argumentRanges).reduce(
        (sum, r) => sum + (r.avg ?? r.max ?? 0),
        0,
      ) || 64;
      this.fingerprintEngine.observe({
        agentId: observation.agentId,
        toolName: observation.toolName,
        argBytes: Math.round(argBytes),
        timestamp: observation.timestamp,
        credentialIdentity: observation.credentialIdentity ?? observation.agentId,
      });
    }

    const w = this.currentWindow;
    w.totalCalls++;

    // Group by tool
    if (!w.byTool[observation.toolName]) {
      w.byTool[observation.toolName] = [];
    }
    w.byTool[observation.toolName]!.push(observation);

    // Track session sequences for co-occurrence
    if (!w.sessionSequences[observation.sessionHash]) {
      w.sessionSequences[observation.sessionHash] = [];
    }
    w.sessionSequences[observation.sessionHash]!.push(observation.toolName);

    // Track co-occurrences (tool pairs within same session)
    const session = w.sessionSequences[observation.sessionHash]!;
    if (session.length >= 2) {
      const prev = session[session.length - 2]!;
      if (!w.coOccurrences[prev]) {
        w.coOccurrences[prev] = {};
      }
      w.coOccurrences[prev]![observation.toolName] =
        (w.coOccurrences[prev]![observation.toolName] || 0) + 1;
    }
  }

  /**
   * Finalize the current window, computing aggregate statistics.
   */
  finalizeWindow(): ObservationWindow | null {
    if (!this.currentWindow) return null;

    const w = this.currentWindow;
    w.complete = true;
    w.uniqueTools = Object.keys(w.byTool).length;
    this.active = false;

    // Compute statistics
    const toolNames = Object.keys(w.byTool);
    w.stats.uniqueTools = toolNames;

    for (const tool of toolNames) {
      const observations = w.byTool[tool]!;
      w.stats.toolCallCounts[tool] = observations.length;

      // Latency percentiles
      const latencies = observations.map(o => o.latencyMs).sort((a, b) => a - b);
      w.stats.toolLatencyP50[tool] = latencies[Math.floor(latencies.length * 0.5)] || 0;
      w.stats.toolLatencyP95[tool] = latencies[Math.floor(latencies.length * 0.95)] || 0;

      // Error rate
      const errors = observations.filter(o => !o.success).length;
      w.stats.toolErrorRate[tool] = observations.length > 0 ? errors / observations.length : 0;

      // Argument keys and types (aggregate across all observations)
      const allKeys = new Set<string>();
      const typeCount: Record<string, Record<string, number>> = {};
      for (const obs of observations) {
        for (const key of obs.argumentKeys) {
          allKeys.add(key);
          if (!typeCount[key]) typeCount[key] = {};
          const argType = obs.argumentTypes[key] || 'unknown';
          typeCount[key]![argType] = (typeCount[key]![argType] || 0) + 1;
        }
      }
      w.stats.argumentKeysByTool[tool] = [...allKeys];
      w.stats.argumentTypesByTool[tool] = {};
      for (const [key, types] of Object.entries(typeCount)) {
        // Pick the most common type
        const bestType = Object.entries(types).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
        w.stats.argumentTypesByTool[tool]![key] = bestType;
      }
    }

    // Common sequences (length 2 and 3)
    const seqCounts = new Map<string, number>();
    for (const seq of Object.values(w.sessionSequences)) {
      // Length 2
      for (let i = 0; i < seq.length - 1; i++) {
        const pair = `${seq[i]}→${seq[i + 1]}`;
        seqCounts.set(pair, (seqCounts.get(pair) || 0) + 1);
      }
      // Length 3
      for (let i = 0; i < seq.length - 2; i++) {
        const triple = `${seq[i]}→${seq[i + 1]}→${seq[i + 2]}`;
        seqCounts.set(triple, (seqCounts.get(triple) || 0) + 1);
      }
    }
    w.stats.commonSequences = [...seqCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([sequence, count]) => ({ sequence: sequence.split('→'), count }));

    // Save to history
    this.windowHistory.push(w);
    if (this.windowHistory.length > 50) {
      this.windowHistory.shift();
    }

    Logger.info(`[BehaviorCollector] Finalized window ${w.windowId}: ${w.totalCalls} calls, ${w.uniqueTools} tools`);
    this.currentWindow = null;
    return w;
  }

  /** Stop the current window without finalizing (discard data). */
  abortWindow(): void {
    this.active = false;
    this.currentWindow = null;
    Logger.info('[BehaviorCollector] Observation window aborted');
  }

  /** Get the current (in-progress) window. */
  getCurrentWindow(): ObservationWindow | null {
    return this.currentWindow;
  }

  /** Get all finalized windows. */
  getHistory(): ObservationWindow[] {
    return [...this.windowHistory];
  }

  /** Check if currently observing. */
  isActive(): boolean {
    return this.active;
  }

  /** Get a summary of observations so far. */
  getSummary(): { totalCalls: number; uniqueTools: number; toolCounts: Record<string, number>; uptimeMin: number } | null {
    if (!this.currentWindow) return null;

    const toolCounts: Record<string, number> = {};
    for (const [tool, obs] of Object.entries(this.currentWindow.byTool)) {
      toolCounts[tool] = obs.length;
    }

    return {
      totalCalls: this.currentWindow.totalCalls,
      uniqueTools: Object.keys(toolCounts).length,
      toolCounts,
      uptimeMin: Math.round(
        (Date.now() - new Date(this.currentWindow.startedAt).getTime()) / 60000,
      ),
    };
  }
}