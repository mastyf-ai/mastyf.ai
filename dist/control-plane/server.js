import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { parsePolicyConfig } from '../policy/policy-schema.js';
import { compilePolicyToRules, compiledRulesEtag } from './compiled-rules.js';
import { validateSignedCompiledRules, } from './compiled-rules-signature.js';
import { registerTenantApiRoutes } from './tenant-api.js';
function resolvePolicyPath(explicitPath) {
    if (explicitPath)
        return explicitPath;
    const fromEnv = process.env['CONTROL_PLANE_POLICY_PATH']
        || process.env['MASTYF_AI_POLICY'];
    if (fromEnv)
        return fromEnv;
    return path.resolve(process.cwd(), 'default-policy.yaml');
}
export function createControlPlaneApp(options) {
    const app = express();
    const policyPath = resolvePolicyPath(options?.policyPath);
    let cachedRules = null;
    let cachedEtag = '';
    let lastLoadedAt = 0;
    const cacheMs = parseInt(process.env['CONTROL_PLANE_RULES_CACHE_MS'] || '2000', 10);
    const readCompiledRules = () => {
        const now = Date.now();
        if (cachedRules && now - lastLoadedAt <= cacheMs)
            return cachedRules;
        const raw = load(readFileSync(policyPath, 'utf-8'));
        const parsed = parsePolicyConfig(raw);
        const compiled = compilePolicyToRules(parsed);
        cachedRules = compiled;
        cachedEtag = compiledRulesEtag(compiled);
        lastLoadedAt = now;
        return compiled;
    };
    app.get('/healthz', (_req, res) => {
        res.json({ ok: true, service: 'mastyf-ai-control-plane' });
    });
    app.get('/readyz', (_req, res) => {
        try {
            readCompiledRules();
            res.json({ ok: true, policyPath });
        }
        catch (error) {
            res.status(503).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    app.get('/internal/api/rules', (req, res) => {
        try {
            const rules = readCompiledRules();
            const rulesJson = JSON.stringify(rules);
            const sigPath = `${policyPath}.compiled.sig.json`;
            let envelope;
            try {
                envelope = JSON.parse(readFileSync(sigPath, 'utf-8'));
            }
            catch {
                envelope = undefined;
            }
            const sigCheck = validateSignedCompiledRules(rulesJson, envelope);
            if (!sigCheck.ok) {
                res.status(500).json({ error: 'compiled_rules_signature_invalid', reason: sigCheck.reason });
                return;
            }
            if (req.headers['if-none-match'] === cachedEtag) {
                res.status(304).end();
                return;
            }
            res.setHeader('ETag', cachedEtag);
            res.setHeader('Cache-Control', 'no-cache');
            if (envelope) {
                res.setHeader('X-Mastyf-Compiled-Rules-Signature', Buffer.from(JSON.stringify(envelope)).toString('base64'));
            }
            res.json(rules);
        }
        catch (error) {
            res.status(500).json({
                error: 'failed_to_compile_rules',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    });
    if (process.env['MASTYF_AI_TENANT_API_ENABLED'] === 'true') {
        app.use(express.json({ limit: '1mb' }));
        registerTenantApiRoutes(app);
    }
    return app;
}
export function startControlPlaneServer(options) {
    const app = createControlPlaneApp(options);
    const port = options?.port ?? parseInt(process.env['CONTROL_PLANE_PORT'] || '3000', 10);
    const policyPath = resolvePolicyPath(options?.policyPath);
    app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`MCP Mastyf AI Control Plane listening on :${port} (policy=${policyPath})`);
    });
}
//# sourceMappingURL=server.js.map