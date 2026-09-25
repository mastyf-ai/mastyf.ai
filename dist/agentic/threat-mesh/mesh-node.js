/**
 * Threat Intelligence Mesh Node — privacy-preserving cross-deployment threat sharing.
 */
import { createHash } from 'crypto';
import { Logger } from '../../utils/logger.js';
import { buildMtxRecord, serializeMtxRecord } from '../../mtx/index.js';
import { MeshRelayClient } from './mesh-relay-client.js';
export class ThreatMeshNode {
    store;
    config;
    localSignatures = new Map();
    pendingSignatures = new Map();
    relay = null;
    pendingRelayPublish = [];
    constructor(store) {
        this.store = store;
        this.config = this.loadConfig();
        if (this.config.relayUrl) {
            this.relay = new MeshRelayClient({
                relayUrl: this.config.relayUrl,
                apiKey: this.config.relayApiKey,
                tenantId: process.env.MASTYF_AI_TENANT_ID || 'default',
            });
        }
        this.hydrateFromStore();
    }
    loadConfig() {
        return {
            enabled: process.env['MASTYF_AI_THREAT_MESH_ENABLED'] === 'true',
            relayUrl: process.env['MASTYF_AI_THREAT_MESH_RELAY_URL'],
            relayApiKey: process.env['MASTYF_AI_THREAT_MESH_RELAY_API_KEY'],
            minReportThreshold: parseInt(process.env['MASTYF_AI_THREAT_MESH_MIN_REPORTS'] || '3', 10),
            privacyEpsilon: parseFloat(process.env['MASTYF_AI_THREAT_MESH_EPSILON'] || '1.0'),
            maxLocalSignatures: parseInt(process.env['MASTYF_AI_THREAT_MESH_MAX_SIGNATURES'] || '10000', 10),
        };
    }
    hydrateFromStore() {
        if (!this.store)
            return;
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
    isEnabled() {
        return this.config.enabled;
    }
    submitObservation(rawPattern, category, severity, toolName = 'unknown') {
        if (!this.config.enabled)
            return null;
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
        const sig = {
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
    async syncWithRelay() {
        if (!this.relay) {
            return { published: 0, pulled: 0, relayConnected: false, error: 'relay_not_configured' };
        }
        let published = 0;
        if (this.pendingRelayPublish.length > 0) {
            const batch = this.pendingRelayPublish.splice(0, 100);
            const result = await this.relay.publish(batch.map((r) => ({
                signatureHash: r.signatureHash,
                mtxJson: r.mtxJson,
                category: r.category,
                severity: r.severity,
                verified: r.verified,
            })));
            if (result.ok)
                published = result.published;
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
    lookupPattern(rawPattern) {
        const hash = this.hashPattern(rawPattern);
        return this.localSignatures.get(hash) || null;
    }
    getAllSignatures() {
        return [...this.localSignatures.values()];
    }
    getSignaturesByCategory(category) {
        return [...this.localSignatures.values()].filter(s => s.category === category);
    }
    getStats() {
        return {
            enabled: this.config.enabled,
            localSignatures: this.localSignatures.size,
            pendingSignatures: this.pendingSignatures.size,
            relayConnected: this.relay?.isConnected() ?? false,
            lastRelaySync: this.relay?.getLastSyncAt() ?? null,
        };
    }
    isKnownThreat(signatureHash) {
        return this.localSignatures.has(signatureHash);
    }
    hashPattern(pattern) {
        return createHash('sha256').update(pattern.toLowerCase().trim()).digest('hex');
    }
    persistMtx(mtx, verified) {
        this.store?.saveMtxSignature(mtx.signatureHash, serializeMtxRecord(mtx), verified);
    }
    queueRelayPublish(mtx, sig) {
        if (!this.relay)
            return;
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
    applyPrivacyNoise(_signatureHash) {
        const epsilon = this.config.privacyEpsilon;
        const probability = Math.min(epsilon / (1 + epsilon), 0.95);
        return Math.random() < probability;
    }
}
//# sourceMappingURL=mesh-node.js.map