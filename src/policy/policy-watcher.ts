import { watch, FSWatcher } from 'chokidar';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { PolicyConfig } from './policy-types.js';
import { PolicyEngine } from './policy-engine.js';
import { Logger } from '../utils/logger.js';

/**
 * Hot-reloadable policy engine wrapper.
 * Watches a YAML policy file for changes and atomically swaps the active policy.
 * In-flight requests continue using the old policy; new requests use the updated one.
 */
export class PolicyWatcher {
  private current: PolicyEngine | null = null;
  private watcher: FSWatcher | null = null;
  private policyPath: string;
  /** Callback invoked after a successful hot-reload (set by ProxyManager) */
  public onReload: (() => void) | null = null;

  constructor(policyPath: string) {
    this.policyPath = policyPath;
    this.loadPolicy();
    this.startWatching();
  }

  private loadPolicy(): void {
    try {
      const yaml = readFileSync(this.policyPath, 'utf-8');
      const config = load(yaml) as PolicyConfig;
      const oldMode = this.current?.getMode();
        this.current = new PolicyEngine(config);
        Logger.info(`[policy-watcher] Policy loaded (mode: ${config.policy.mode}, rules: ${config.policy.rules.length})${oldMode && oldMode !== config.policy.mode ? ` (mode changed from ${oldMode})` : ''}`);
        // Notify external components of successful reload
        if (this.onReload) {
          this.onReload();
        }
    } catch (err: any) {
      Logger.error(`[policy-watcher] Failed to load policy: ${err?.message}`);
      // Don't replace the current policy on parse failure
      if (!this.current) {
        throw err; // No existing policy — must fail
      }
    }
  }

  private startWatching(): void {
    this.watcher = watch(this.policyPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on('change', () => {
      Logger.info(`[policy-watcher] Policy file changed, reloading...`);
      this.loadPolicy();
    });

    this.watcher.on('error', (err: any) => {
      Logger.error(`[policy-watcher] Watch error: ${err?.message || String(err)}`);
    });

    Logger.info(`[policy-watcher] Watching ${this.policyPath} for changes`);
  }

  /**
   * Get the current (active) policy engine.
   * This is always the latest loaded version.
   */
  get(): PolicyEngine | null {
    return this.current;
  }

  /**
   * Stop watching and clean up.
   */
  close(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}