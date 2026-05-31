import { watch, FSWatcher } from 'chokidar';
import { existsSync, readFileSync } from 'fs';
import { dirname, basename, join } from 'path';
import { load } from 'js-yaml';
import { PolicyConfig } from './policy-types.js';
import { PolicyEngine } from './policy-engine.js';
import { getOrCreatePolicyEngine } from './policy-engine-cache.js';
import { parsePolicyConfig } from './policy-schema.js';
import { applyPolicyMerges } from './policy-merge.js';
import { getPolicyAuditor } from '../utils/enterprise-bootstrap.js';
import { registerReadinessCheck } from '../utils/readiness.js';
import { Logger } from '../utils/logger.js';
import {
  type PolicySignatureEnvelope,
  validateSignedPolicyYaml,
} from './policy-signature.js';
import { validateAllowlistRbac } from './policy-allowlist-guard.js';

const RELOAD_DEBOUNCE_MS = 50;

/**
 * Hot-reloadable policy engine wrapper.
 * Builds a new PolicyEngine off the event-loop critical path, then atomically swaps
 * `current` in one assignment. evaluate() always reads the active engine ref — never
 * blocks on file I/O and never returns "reload in progress" blocks.
 */
export class PolicyWatcher {
  private current: PolicyEngine | null = null;
  private watcher: FSWatcher | null = null;
  private policyPath: string;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadInFlight = false;
  /** Callback invoked after a successful hot-reload (set by ProxyManager) */
  public onReload: (() => void) | null = null;

  constructor(policyPath: string) {
    this.policyPath = policyPath;
    registerReadinessCheck(async () => ({
      ok: this.current !== null,
      detail: this.current ? 'policy loaded' : 'policy not loaded',
    }));
    this.loadPolicySync();
    this.startWatching();
  }

  /** Synchronous initial load only — subsequent reloads are debounced + async. */
  private loadPolicySync(): void {
    const engine = this.buildEngineFromDisk();
    if (engine) {
      this.current = engine;
    } else if (!this.current) {
      throw new Error(`[policy-watcher] Failed to load initial policy from ${this.policyPath}`);
    }
  }

  private buildEngineFromDisk(): PolicyEngine | null {
    try {
      const yaml = readFileSync(this.policyPath, 'utf-8');
      const signaturePath = join(dirname(this.policyPath), `.${basename(this.policyPath)}.sig.json`);
      const envelope = existsSync(signaturePath)
        ? (JSON.parse(readFileSync(signaturePath, 'utf-8')) as PolicySignatureEnvelope)
        : undefined;
      const sigCheck = validateSignedPolicyYaml(yaml, envelope);
      if (!sigCheck.ok) {
        throw new Error(`Policy signature validation failed: ${sigCheck.reason}`);
      }
      const auditor = getPolicyAuditor();
      if (auditor?.hasChanged(yaml)) {
        auditor.record({
          timestamp: new Date().toISOString(),
          actor: process.env['GUARDIAN_POLICY_ACTOR'] || 'system',
          change: 'policy_hot_reload',
          newValue: auditor.computeHash(yaml),
          sourceHash: auditor.computeHash(yaml),
        });
      }
      const config = applyPolicyMerges(parsePolicyConfig(load(yaml)));
      validateAllowlistRbac(config);
      const oldMode = this.current?.getMode();
      const engine = getOrCreatePolicyEngine(config);
      Logger.info(
        `[policy-watcher] Policy loaded (mode: ${config.policy.mode}, rules: ${config.policy.rules.length})` +
        (oldMode && oldMode !== config.policy.mode ? ` (mode changed from ${oldMode})` : ''),
      );
      return engine;
    } catch (err: any) {
      Logger.error(`[policy-watcher] Failed to load policy: ${err?.message}`);
      return null;
    }
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.reloadPolicyAsync();
    }, RELOAD_DEBOUNCE_MS);
  }

  private async reloadPolicyAsync(): Promise<void> {
    if (this.reloadInFlight) return;
    this.reloadInFlight = true;
    try {
      const pending = await new Promise<PolicyEngine | null>((resolve) => {
        setImmediate(() => resolve(this.buildEngineFromDisk()));
      });
      if (pending) {
        this.current = pending;
        try {
          const { recordConfigProvenance } = await import('../agentic/provenance/config-provenance-chain.js');
          recordConfigProvenance({
            actor: process.env.GUARDIAN_POLICY_ACTOR ?? 'policy-watcher',
            eventType: 'policy_reload',
            resourcePath: this.policyPath,
            diff: { mode: pending.getMode(), rules: pending.getRules?.()?.length ?? 0 },
          });
        } catch {
          /* best-effort */
        }
        if (this.onReload) this.onReload();
      }
    } finally {
      this.reloadInFlight = false;
    }
  }

  private startWatching(): void {
    this.watcher = watch(this.policyPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on('change', () => {
      Logger.info(`[policy-watcher] Policy file changed, scheduling reload...`);
      this.scheduleReload();
    });

    this.watcher.on('error', (err: any) => {
      Logger.error(`[policy-watcher] Watch error: ${err?.message || String(err)}`);
    });

    Logger.info(`[policy-watcher] Watching ${this.policyPath} for changes`);
  }

  /**
   * Get the current (active) policy engine.
   * Always the latest successfully loaded version; never null after initial load.
   */
  get(): PolicyEngine | null {
    return this.current;
  }

  /** Force reload from disk (e.g. after cloud policy sync write). */
  async reloadNow(): Promise<void> {
    await this.reloadPolicyAsync();
  }

  /** @internal — deterministic reload for tests (skips chokidar debounce). */
  async forceReloadForTests(): Promise<void> {
    await this.reloadPolicyAsync();
  }

  close(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
