import { describe, it, expect } from 'vitest';
import { buildMtxRecord, validateMtxRecord, hashSignature } from '../../packages/mtx/src/index.js';
import { IntentEngine } from '../../src/agentic/intent-binding/intent-engine.js';
import { SandboxTierEnforcer } from '../../src/agentic/sandbox-tier/enforcer.js';
import { runGuardianBenchScorecard } from '../../src/utils/guardian-bench.js';
import { signCertAttestation, verifyCertAttestation } from '../../src/agentic/certification/cert-signing.js';

describe('industry-standard foundations', () => {
  it('builds valid MTX records', () => {
    const record = buildMtxRecord({
      toolName: 'read_file',
      argFingerprint: 'abc123',
      category: 'path_traversal',
      blockReason: 'blocked ../etc/passwd',
    });
    expect(validateMtxRecord(record)).toBe(true);
    expect(record.signatureHash).toBe(hashSignature(`read_file:${record.argPatternHash}:path_traversal`));
  });

  it('intent engine allows calls when no binding', () => {
    const engine = new IntentEngine();
    expect(engine.isCallAllowed('sess-1', 'read_file').allowed).toBe(true);
    engine.declareIntent('sess-2', 'read docs', ['read_file']);
    expect(engine.isCallAllowed('sess-2', 'read_file').allowed).toBe(true);
    expect(engine.isCallAllowed('sess-2', 'run_terminal').allowed).toBe(false);
  });

  it('sandbox enforcer defaults to allow', () => {
    const enforcer = new SandboxTierEnforcer();
    expect(enforcer.getTier({ scopeType: 'server', scopeId: 'fs' })).toBe('allow');
  });

  it('bench scorecard returns structure', () => {
    const card = runGuardianBenchScorecard('/nonexistent', 'test');
    expect(card.profile).toBe('test');
    expect(typeof card.blockRate).toBe('number');
  });

  it('cert attestation round-trips with key', () => {
    process.env.GUARDIAN_CERT_SIGNING_KEY = 'test-key-industry-standard';
    const token = signCertAttestation({
      serverName: 'fs',
      packageName: '@test/fs',
      version: '1.0.0',
      level: 'gold',
      score: 85,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(verifyCertAttestation(token).valid).toBe(true);
    delete process.env.GUARDIAN_CERT_SIGNING_KEY;
  });
});
