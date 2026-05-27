import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { parsePolicyConfig } from '../policy/policy-schema.js';
import {
  compilePolicyToRules,
  compiledRulesEtag,
  type CompiledRules,
} from './compiled-rules.js';

function resolvePolicyPath(explicitPath?: string): string {
  if (explicitPath) return explicitPath;
  const fromEnv = process.env['CONTROL_PLANE_POLICY_PATH']
    || process.env['MCP_GUARDIAN_POLICY'];
  if (fromEnv) return fromEnv;
  return path.resolve(process.cwd(), 'default-policy.yaml');
}

export function startControlPlaneServer(options?: {
  port?: number;
  policyPath?: string;
}): void {
  const app = express();
  const port = options?.port ?? parseInt(process.env['CONTROL_PLANE_PORT'] || '3000', 10);
  const policyPath = resolvePolicyPath(options?.policyPath);

  let cachedRules: CompiledRules | null = null;
  let cachedEtag = '';
  let lastLoadedAt = 0;
  const cacheMs = parseInt(process.env['CONTROL_PLANE_RULES_CACHE_MS'] || '2000', 10);

  const readCompiledRules = (): CompiledRules => {
    const now = Date.now();
    if (cachedRules && now - lastLoadedAt <= cacheMs) return cachedRules;
    const raw = load(readFileSync(policyPath, 'utf-8'));
    const parsed = parsePolicyConfig(raw);
    const compiled = compilePolicyToRules(parsed);
    cachedRules = compiled;
    cachedEtag = compiledRulesEtag(compiled);
    lastLoadedAt = now;
    return compiled;
  };

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'mcp-guardian-control-plane' });
  });

  app.get('/readyz', (_req, res) => {
    try {
      readCompiledRules();
      res.json({ ok: true, policyPath });
    } catch (error) {
      res.status(503).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/internal/api/rules', (req, res) => {
    try {
      const rules = readCompiledRules();
      if (req.headers['if-none-match'] === cachedEtag) {
        res.status(304).end();
        return;
      }
      res.setHeader('ETag', cachedEtag);
      res.setHeader('Cache-Control', 'no-cache');
      res.json(rules);
    } catch (error) {
      res.status(500).json({
        error: 'failed_to_compile_rules',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `MCP Guardian Control Plane listening on :${port} (policy=${policyPath})`,
    );
  });
}
