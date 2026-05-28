/**
 * MCP Guardian Detector Plugin SDK v3.0 — stable API for custom secret/argument scanners.
 * @see docs/PLUGIN_SDK.md
 */

export type DetectorSeverity = 'HIGH' | 'MEDIUM' | 'high' | 'medium';

export interface DetectorScanContext {
  serverName?: string;
  toolName?: string;
  location?: string;
}

export interface DetectorFinding {
  type: string;
  location: string;
  severity: DetectorSeverity;
  redacted?: string;
  context?: string;
  method?: 'regex' | 'heuristic' | 'llm' | string;
}

export interface DetectorPluginLifecycle {
  onLoad?(): void | Promise<void>;
  onUnload?(): void | Promise<void>;
}

export interface DetectorPlugin extends DetectorPluginLifecycle {
  /** Unique plugin id (semver-safe name, e.g. acme-pii-scanner) */
  name: string;
  /** Optional version for audit logs */
  version?: string;
  scanArguments(text: string, ctx: DetectorScanContext): DetectorFinding[] | Promise<DetectorFinding[]>;
}

export interface CreatePluginOptions {
  name: string;
  version?: string;
  scanArguments: DetectorPlugin['scanArguments'];
  onLoad?: DetectorPluginLifecycle['onLoad'];
  onUnload?: DetectorPluginLifecycle['onUnload'];
}

/** Factory for typed plugins with lifecycle hooks. */
export function createDetectorPlugin(opts: CreatePluginOptions): DetectorPlugin {
  return {
    name: opts.name,
    version: opts.version,
    onLoad: opts.onLoad,
    onUnload: opts.onUnload,
    scanArguments: opts.scanArguments,
  };
}

/** SDK version string embedded in registry logs. */
export const PLUGIN_SDK_VERSION = '3.3.1';
