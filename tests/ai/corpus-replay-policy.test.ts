import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import { load } from 'js-yaml';
import { readFileSync } from 'fs';
import {
  corpusReplayPolicyPath,
  evaluateCorpusFixture,
  loadCorpusReplayPolicyEngine,
  validateThreatLabDiscovery,
  type ThreatLabDiscovery,
} from '../../src/ai/threat-lab.js';
import type { PolicyConfig } from '../../src/policy/policy-types.js';

describe('corpus replay policy split', () => {
  const prevPolicy = process.env.GUARDIAN_POLICY_PATH;
  const prevReplay = process.env.GUARDIAN_CORPUS_REPLAY_POLICY_PATH;

  beforeEach(() => {
    process.env.GUARDIAN_POLICY_PATH = join(process.cwd(), 'policy-demo.yaml');
    process.env.GUARDIAN_CORPUS_REPLAY_POLICY_PATH = join(process.cwd(), 'default-policy.yaml');
  });

  afterEach(() => {
    if (prevPolicy === undefined) delete process.env.GUARDIAN_POLICY_PATH;
    else process.env.GUARDIAN_POLICY_PATH = prevPolicy;
    if (prevReplay === undefined) delete process.env.GUARDIAN_CORPUS_REPLAY_POLICY_PATH;
    else process.env.GUARDIAN_CORPUS_REPLAY_POLICY_PATH = prevReplay;
  });

  it('defaults corpus replay path to default-policy.yaml', () => {
    delete process.env.GUARDIAN_CORPUS_REPLAY_POLICY_PATH;
    expect(corpusReplayPolicyPath()).toBe(join(process.cwd(), 'default-policy.yaml'));
  });

  it('blocks path traversal under replay policy but not permissive live policy', () => {
    const candidate = {
      id: 'replay-test',
      toolName: 'read_file',
      arguments: { path: '../../../etc/passwd' },
      expected: 'block' as const,
      category: 'path-traversal',
    };

    const livePolicy = load(readFileSync(process.env.GUARDIAN_POLICY_PATH!, 'utf-8')) as PolicyConfig;
    const liveEngine = new PolicyEngine(livePolicy);
    const replayEngine = loadCorpusReplayPolicyEngine();

    expect(evaluateCorpusFixture(candidate, liveEngine).blocked).toBe(false);
    expect(evaluateCorpusFixture(candidate, replayEngine).blocked).toBe(true);
  });

  it('passes replay validation when live policy is permissive', () => {
    const discovery: ThreatLabDiscovery = {
      attackClass: 'path-traversal',
      hypothesis: 'traversal via ..',
      corpusCandidate: {
        id: 'replay-test',
        toolName: 'read_file',
        arguments: { path: '../../../etc/passwd' },
        expected: 'block',
        category: 'path-traversal',
      },
      policyRule: {
        name: 'threat-lab-path',
        action: 'block',
        patterns: ['\\.\\./'],
      },
      confidence: 0.9,
    };

    const result = validateThreatLabDiscovery(discovery, { requireReplayBlock: true });
    expect(result.ok).toBe(true);
    expect(result.replayBlocked).toBe(true);
  });
});
