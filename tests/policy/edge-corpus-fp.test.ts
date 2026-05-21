import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { PolicyConfig } from '../../src/policy/policy-types.js';
describe('edge corpus false positives', () => {
  const policy = load(readFileSync(join(process.cwd(), 'default-policy.yaml'), 'utf8')) as PolicyConfig;
  const engine = new PolicyEngine(policy);

  for (const file of ['edge-001.json', 'edge-016.json', 'edge-017.json', 'edge-019.json']) {
    it(`allows ${file}`, async () => {
      const entry = JSON.parse(
        readFileSync(join(process.cwd(), 'corpus/edge-cases', file), 'utf8'),
      );
      const decision = await engine.evaluate({
        serverName: 'test',
        toolName: entry.toolName,
        arguments: entry.arguments,
        requestId: 1,
        requestTokens: 1,
        timestamp: new Date().toISOString(),
      });
      expect(decision, JSON.stringify(decision)).toMatchObject({ action: 'pass' });
    });
  }
});
