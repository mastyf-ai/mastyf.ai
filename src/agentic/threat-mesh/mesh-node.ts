/**
 * Threat Intelligence Mesh Node — privacy-preserving cross-deployment threat sharing.
 */
import { createHash } from 'crypto';
import { Logger } from '../../utils/logger.js';
import { buildMtxRecord, serializeMtxRecord } from '../../mtx/index.js';
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { MeshRelayClient } from './mesh-relay-client.js';

export interface ThreatSignature {
  signatureHash: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  firstSeen: string;
  reportCount: number;
  verified: boolean;
  metadata?: Record<string, unknown>;
}

export interface MeshConfig {
  enabled: boolean;
  relayUrl?: string;
  relayApiKey?: string;
  minReportThreshold: number;
  privacyEpsilon: number;
  maxLocalSignatures: number;
}

export interface MeshSyncResult {
  published: number;
  pulled: number;
  relayConnected: boolean;
  error?: string;
}

export class ThreatMeshNode {
  private config: MeshConfig;
  private localSignatures = new Map<string, ThreatSignature>();
  private pendingSignatures = new Map<string, { count: number; signature: ThreatSignature }>();
  private relay: MeshRelayClient | null = null;
  private pendingRelayPublish: Array<{ signatureHash: string; mtxJson: string; category: string; severity: string; verified: boolean }> = [];

  constructor(private readonly store?: IndustryStandardStore) {
    this.config = this.loadConfig();
    if (this.config.relayUrl) {
      this.relay = new MeshRelayClient({
        relayUrl: this.config.relayUrl,
        apiKey: this.config.relayApiKey,
        tenantId: process.env.GUARDIAN_TENANT_ID || 'default',
      });
    }
    this.hydrateFromStore();
  }

  private loadConfig(): MeshConfig {
    return {
      enabled: process.env['GUARDIAN_THREAT_MESH_ENABLED'] === 'true',
      relayUrl: process.env['GUARDIAN_THREAT_MESH_RELAY_URL'],
      relayApiKey: process.env['GUARDIAN_THREAT_MESH_RELAY_API_KEY'],
      minReportThreshold: parseInt(process.env['GUARDIAN_THREAT_MESH_MIN_REPORTS'] || '3', 10),
      privacyEpsilon: parseFloat(process.env['GUARDIAN_THREAT_MESH_EPSILON'] || '1.0'),
      maxLocalSignatures: parseInt(process.env['GUARDIAN_THREAT_MESH_MAX_SIGNATURES'] || '10000', 10),
    };
  }

  private hydrateFromStore(): void {
    if (!this.store) return;
    for (const row of this.store.listMtxSignatures('default', this.config.maxLocalSignatures)) {
      this.localSignatures.set(row.signatureHash, {
        signatureHash: row.signatureHash,
        category: row.category,
        severity: row.severity,
        firstSeen: row.firstSeen,
        reportCount: row.reportCount,
        verified: row.verified,
      });
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  submitObservation(
    rawPattern: string,
    category: string,
    severity: ThreatSignature['severity'],
    toolName = 'unknown',
  ): ThreatSignature | null {
    if (!this.config.enabled) return null;

    const signatureHash = this.hashPattern(rawPattern);
    const mtx = buildMtxRecord({
      toolName,
      argFingerprint: rawPattern,
      category,
      blockReason: `${severity}:${category}`,
    });

    if (!this.applyPrivacyNoise(signatureHash)) {
      Logger.debug(`[ThreatMesh] Privacy filter suppressed signature: ${signatureHash.slice(0, 8)}`);
      return null;
    }

    const pending = this.pendingSignatures.get(signatureHash);
    if (pending) {
      pending.count++;
      if (pending.count >= this.config.minReportThreshold) {
        const sig = pending.signature;
        sig.reportCount = pending.count;
        sig.verified = pending.count >= 5;
        this.localSignatures.set(signatureHash, sig);
        this.pendingSignatures.delete(signatureHash);
        this.persistMtx(mtx, sig.verified);
        this.queueRelayPublish(mtx, sig);
        Logger.info(`[ThreatMesh] Signature ${signatureHash.slice(0, 8)} promoted (${sig.reportCount} reports)`);
        return sig;
      }
      return null;
    }

    const sig: ThreatSignature = {
      signatureHash,
      category,
      severity,
      firstSeen: new Date().toISOString(),
      reportCount: 1,
      verified: false,
      metadata: { mtxVersion: mtx.mtxVersion, argPatternHash: mtx.argPatternHash },
    };

    this.pendingSignatures.set(signatureHash, { count: 1, signature: sig });

    if (this.config.minReportThreshold <= 1) {
      this.localSignatures.set(signatureHash, sig);
      this.pendingSignatures.delete(signatureHash);
      this.persistMtx(mtx, false);
      this.queueRelayPublish(mtx, sig);
      return sig;
    }

    return null;
  }

  async syncWithRelay(): Promise<MeshSyncResult> {
    if (!this.relay) {
      return { published: 0, pulled: 0, relayConnected: false, error: 'relay_not_configured' };
    }

    let published = 0;
    if (this.pendingRelayPublish.length > 0) {
      const batch = this.pendingRelayPublish.splice(0, 100);
      const result = await this.relay.publish(
        batch.map((r) => ({
          signatureHash: r.signatureHash,
          mtxJson: r.mtxJson,
          category: r.category,
          severity: r.severity,
          verified: r.verified,
        })),
      );
      if (result.ok) published = result.published;
    }

    const pull = await this.relay.pullCatalog(500);
    let pulled = 0;
    if (pull.ok) {
      for (const sig of pull.signatures) {
        if (!this.localSignatures.has(sig.signatureHash)) {
          this.localSignatures.set(sig.signatureHash, sig);
          pulled++;
        }
      }
    }

    return {
      published,
      pulled,
      relayConnected: this.relay.isConnected(),
      error: pull.error,
    };
  }

  lookupPattern(rawPattern: string): ThreatSignature | null {
    const hash = this.hashPattern(rawPattern);
    return this.localSignatures.get(hash) || null;
  }

  getAllSignatures(): ThreatSignature[] {
    return [...this.localSignatures.values()];
  }

  getSignaturesByCategory(category: string): ThreatSignature[] {
    return [...this.localSignatures.values()].filter(s => s.category === category);
  }

  getStats(): {
    enabled: boolean;
    localSignatures: number;
    pendingSignatures: number;
    relayConnected: boolean;
    lastRelaySync?: string | null;
  } {
    return {
      enabled: this.config.enabled,
      localSignatures: this.localSignatures.size,
      pendingSignatures: this.pendingSignatures.size,
      relayConnected: this.relay?.isConnected() ?? false,
      lastRelaySync: this.relay?.getLastSyncAt() ?? null,
    };
  }

  isKnownThreat(signatureHash: string): boolean {
    return this.localSignatures.has(signatureHash);
  }

  private hashPattern(pattern: string): string {
    return createHash('sha256').update(pattern.toLowerCase().trim()).digest('hex');
  }

  private persistMtx(mtx: ReturnType<typeof buildMtxRecord>, verified: boolean): void {
    this.store?.saveMtxSignature(mtx.signatureHash, serializeMtxRecord(mtx), verified);
  }

  private queueRelayPublish(mtx: ReturnType<typeof buildMtxRecord>, sig: ThreatSignature): void {
    if (!this.relay) return;
    this.pendingRelayPublish.push({
      signatureHash: sig.signatureHash,
      mtxJson: serializeMtxRecord(mtx),
      category: sig.category,
      severity: sig.severity,
      verified: sig.verified,
    });
    if (this.pendingRelayPublish.length >= 10) {
      void this.syncWithRelay();
    }
  }

  private applyPrivacyNoise(_signatureHash: string): boolean {
    const epsilon = this.config.privacyEpsilon;
    const probability = Math.min(epsilon / (1 + epsilon), 0.95);
    return Math.random() < probability;
  }
}
