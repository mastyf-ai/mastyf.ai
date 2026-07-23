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
import { clearPolicyLoadError, recordPolicyLoadError } from './policy-load-metrics.js';
import { setTribunalPolicyFromConfig } from './tribunal-policy.js';
import { setPolicyVersionForCache, invalidateLlmCache } from '@mastyf-ai/core';

const RELOAD_DEBOUNCE_MS = 50;
const RELOAD_DRAIN_MS = parseInt(process.env['MASTYF_AI_POLICY_RELOAD_DRAIN_TIMEOUT_MS'] || '30000', 10);

/**
 * Hot-reloadable policy engine wrapper.
 * Builds a new PolicyEngine off the event-loop critical path, then swaps after in-flight
 * evaluations complete (M-003). On validation failure during reload, retains the prior
 * engine and emits policy_load_error metrics (M-012).
 */
export class PolicyWatcher {
  private current: PolicyEngine | null = null;
  private pendingEngine: PolicyEngine | null = null;
  private evalInflight = 0;
  private watcher: FSWatcher | null = null;
  private policyPath: string;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadInFlight = false;
  private loadedPolicyVersion = 'default';
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
          actor: process.env['MASTYF_AI_POLICY_ACTOR'] || 'system',
          change: 'policy_hot_reload',
          newValue: auditor.computeHash(yaml),
          sourceHash: auditor.computeHash(yaml),
        });
      }
      const config = applyPolicyMerges(parsePolicyConfig(load(yaml)));
      validateAllowlistRbac(config);
      setTribunalPolicyFromConfig(config.policy.tribunal);
      this.loadedPolicyVersion = config.version;
      setPolicyVersionForCache(config.version);
      const oldMode = this.current?.getMode();
      const engine = getOrCreatePolicyEngine(config);
      Logger.info(
        `[policy-watcher] Policy loaded (mode: ${config.policy.mode}, rules: ${config.policy.rules.length})` +
        (oldMode && oldMode !== config.policy.mode ? ` (mode changed from ${oldMode})` : ''),
      );
      return engine;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`[policy-watcher] Failed to load policy: ${msg}`);
      if (this.current) {
        Logger.warn(
          '[policy-watcher] Policy reload failed — retaining prior policy (fail-open on stale rules; see docs/AUDIT_FINDINGS_RESPONSE.md M-015)',
        );
      }
      recordPolicyLoadError(msg);
      return null;
    }
  }

  private async waitForEvalDrain(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.evalInflight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.evalInflight === 0;
  }

  /** Pin active engine for evaluation — defers hot-swap until drain (M-003). */
  pinEngineForEval(): PolicyEngine | null {
    this.evalInflight += 1;
    return this.current;
  }

  unpinEngineForEval(): void {
    if (this.evalInflight > 0) this.evalInflight -= 1;
    if (this.evalInflight === 0 && this.pendingEngine) {
      this.current = this.pendingEngine;
      this.pendingEngine = null;
      Logger.info('[policy-watcher] Deferred policy swap applied after eval drain');
      if (this.onReload) this.onReload();
    }
  }

  async withEngineAsync<T>(fn: (engine: PolicyEngine) => Promise<T>): Promise<T | null> {
    const engine = this.pinEngineForEval();
    if (!engine) return null;
    try {
      return await fn(engine);
    } finally {
      this.unpinEngineForEval();
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
        clearPolicyLoadError();
        const drained = await this.waitForEvalDrain(RELOAD_DRAIN_MS);
        if (!drained) {
          this.pendingEngine = pending;
          Logger.warn('[policy-watcher] Reload deferred — evaluations still in flight');
        } else {
          this.current = pending;
        }
        try {
          setPolicyVersionForCache(this.loadedPolicyVersion);
          await invalidateLlmCache();
        } catch {
          /* core package optional in some test contexts */
        }
        try {
          const { recordConfigProvenance } = await import('../agentic/provenance/config-provenance-chain.js');
          recordConfigProvenance({
            actor: process.env.MASTYF_AI_POLICY_ACTOR ?? 'policy-watcher',
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

  /** Apply a YAML string from a remote source (e.g., control plane) without writing to disk. */
  reloadFromYamlString(yaml: string): boolean {
    try {
      const config = applyPolicyMerges(parsePolicyConfig(load(yaml)));
      validateAllowlistRbac(config);
      setTribunalPolicyFromConfig(config.policy.tribunal);
      this.loadedPolicyVersion = config.version;
      setPolicyVersionForCache(config.version);
      const engine = getOrCreatePolicyEngine(config);
      this.current = engine;
      this.pendingEngine = null;
      Logger.info(`[policy-watcher] Policy updated from remote (version: ${config.version}, mode: ${config.policy.mode}, rules: ${config.policy.rules.length})`);
      if (this.onReload) this.onReload();
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`[policy-watcher] Failed to apply remote policy: ${msg}`);
      recordPolicyLoadError(msg);
      return false;
    }
  }

  getPolicyVersion(): string {
    return this.loadedPolicyVersion;
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
