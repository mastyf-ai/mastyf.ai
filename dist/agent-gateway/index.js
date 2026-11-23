/**
 * Entrypoint for the Agent Gateway external processing service.
 *
 * Deploys as its own Cloud Run container. The `ext_proc` contract is served over
 * gRPC only, so Cloud Run health checks are configured as TCP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import { ServerCredentials } from '@grpc/grpc-js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { Logger } from '../utils/logger.js';
import { getIndustryHotState } from '../database/industry-hot-state.js';
import { setAgenticContainer } from '../utils/agentic-container.js';
import { isRedisConfigured } from '../utils/redis-client.js';
import { buildCapabilityReport, findMissingRequired, formatCapabilityReport, buildCapabilityArtifact, diffCapabilityArtifact, } from './capabilities.js';
import { createExternalProcessorServer } from './server.js';
/**
 * How `requestTokens` is populated, reported verbatim in the capability contract.
 *
 * Kept next to the report so the two cannot drift: if the decision core changes
 * how it fills the field, this constant is what says so out loud.
 */
const REQUEST_TOKENS_MODE = 'estimated';
/**
 * Whether the authorizer refuses to serve without a working agentic container.
 *
 * Defaults to true. `certification`, `behavioral-biometrics`, and `zero-trust`
 * all return `null` when the container is absent, so without this the service
 * would boot, label nothing, and skip three strategies on every request.
 */
function requireAgentic() {
    return process.env['MASTYF_AGENT_GATEWAY_REQUIRE_AGENTIC'] !== 'false';
}
/**
 * Strict mode without shared state is a startup error, checked here so the
 * reason is attributable.
 *
 * `createContainer` already calls `process.exit(1)` for this combination
 * (`container.ts`, the Redis-not-configured branch), but reaching it means
 * exiting from several frames deep with no indication of which precondition
 * failed. Checking first turns a crashloop into one named error.
 *
 * Only applies to multi-replica or Kubernetes: on a single replica the
 * in-process caches are the whole world, so there is nothing global to lose.
 */
/**
 * Writes the machine-readable capability artifact and enforces the drift gate.
 *
 * Returns `null` when serving may continue, or a refusal reason. Kept as a
 * returned string rather than an inline `process.exit` so it is testable --
 * an inline exit is indistinguishable from a crashloop in a deploy log.
 *
 * Both halves are opt-in so the read-only default image touches nothing:
 *   MASTYF_AGENT_GATEWAY_CAPABILITY_REPORT    -- path to write the artifact to
 *   MASTYF_AGENT_GATEWAY_CAPABILITY_BASELINE  -- committed artifact to diff against
 *
 * Configuring a baseline is an explicit opt-in to failing the deploy, so a
 * capability that silently loses `live` blocks instead of shipping.
 */
export async function publishCapabilityArtifact(report) {
    const reportPath = process.env['MASTYF_AGENT_GATEWAY_CAPABILITY_REPORT'];
    const baselinePath = process.env['MASTYF_AGENT_GATEWAY_CAPABILITY_BASELINE'];
    if (!reportPath && !baselinePath)
        return null;
    const artifact = buildCapabilityArtifact(report);
    if (reportPath) {
        try {
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { dirname } = await import('node:path');
            await mkdir(dirname(reportPath), { recursive: true });
            await writeFile(reportPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
            Logger.info(`[agent-gateway] Capability artifact written to ${reportPath}`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return `failed to write the capability artifact to ${reportPath}: ${msg}`;
        }
    }
    if (baselinePath) {
        let baseline;
        try {
            const { readFile } = await import('node:fs/promises');
            baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return `could not read the capability baseline ${baselinePath}: ${msg}`;
        }
        if (!baseline || typeof baseline !== 'object' || !Array.isArray(baseline.capabilities)) {
            return `capability baseline ${baselinePath} is not a capability artifact (missing capabilities[])`;
        }
        const drift = diffCapabilityArtifact(baseline, report);
        if (drift.length > 0) {
            return `capability drift against ${baselinePath} -- ${drift.join('; ')}`;
        }
        Logger.info(`[agent-gateway] Capability report matches baseline ${baselinePath}`);
    }
    return null;
}
export function strictModePrecondition() {
    if (process.env['MASTYF_AI_STRICT_MODE'] !== 'true')
        return null;
    if (isRedisConfigured())
        return null;
    const replicaCount = Number.parseInt(process.env['REPLICA_COUNT'] ?? '1', 10);
    const inK8s = Boolean(process.env['KUBERNETES_SERVICE_HOST']);
    if (replicaCount <= 1 && !inK8s)
        return null;
    return (`MASTYF_AI_STRICT_MODE=true requires shared state, but no Redis is configured and this ` +
        `deployment looks multi-replica (REPLICA_COUNT=${replicaCount}, KUBERNETES_SERVICE_HOST=${inK8s}). ` +
        `Without Redis, rate limits, session-flow history, and replay protection are per-replica, ` +
        `so strict mode cannot fail closed on a dependency it cannot see. ` +
        `Set REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES.`);
}
/**
 * Builds the agentic container so the agentic strategies have real state.
 *
 * `createContainer` is pure construction -- it starts no timers -- so it is safe
 * on a latency-sensitive authorization path. Failure is not fatal here; the
 * capability report and the startup guard decide what happens next, so the
 * reason a capability is missing is always attributable.
 */
async function initAgenticContainer() {
    if (process.env['MASTYF_AI_AGENTIC_ENABLED'] === 'false') {
        Logger.warn('[agent-gateway] MASTYF_AI_AGENTIC_ENABLED=false: certification, behavioral-biometrics, ' +
            'zero-trust, and the agentic pre-guard hooks will be skipped on every request');
        return;
    }
    try {
        const { createContainer } = await import('../container.js');
        const container = await createContainer(process.env['MASTYF_AI_DB_PATH']);
        setAgenticContainer(container);
        Logger.info('[agent-gateway] Agentic container initialized for policy strategies');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Logger.error(`[agent-gateway] Agentic container initialization failed: ${message}`);
    }
}
/**
 * Policy used only when no policy file is supplied.
 *
 * This is genuinely fail-closed, which the previous version was not. The engine
 * resolves an unmatched call to `default_action` (see `PolicyEngine.evaluate`),
 * so `default_action: 'pass'` with no rules authorised every tool call -- the
 * exact opposite of the comment that claimed otherwise. Denying instead means an
 * operator who deploys without mounting a policy gets visible, safe refusals
 * (`rule: 'default'`) rather than a silent authorizer that approves everything.
 */
const FALLBACK_POLICY = {
    version: 'agent-gateway-fallback',
    policy: {
        mode: 'block',
        default_action: 'block',
        rules: [],
    },
};
export function loadPolicyConfig(policyPath) {
    if (!policyPath)
        return FALLBACK_POLICY;
    const resolved = path.resolve(policyPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Policy file not found at ${resolved}. Mount the policy file or unset MASTYF_AI_POLICY_PATH.`);
    }
    const parsed = yaml.load(fs.readFileSync(resolved, 'utf8'));
    if (!parsed?.policy || !Array.isArray(parsed.policy.rules)) {
        throw new Error(`Policy file ${resolved} is not a valid Mastyf PolicyConfig (missing policy.rules).`);
    }
    return parsed;
}
export async function start() {
    const port = Number(process.env['PORT'] ?? 8080);
    const policyPath = process.env['MASTYF_AI_POLICY_PATH'];
    const policy = loadPolicyConfig(policyPath);
    Logger.info(`[agent-gateway] Loading policy from ${policyPath ?? 'built-in fallback'} (${policy.policy.rules.length} rules)`);
    if (!policyPath) {
        Logger.error('[agent-gateway] No MASTYF_AI_POLICY_PATH set. Running on the built-in deny-all ' +
            'fallback, so every tool call will be refused. Mount a policy file before serving traffic.');
    }
    // Before the policy engine and before the container: the agentic strategies
    // read from that container, and a container that fails to initialize turns
    // three strategies into no-ops.
    const precondition = strictModePrecondition();
    if (precondition) {
        Logger.error(`[agent-gateway] Refusing to serve: ${precondition}`);
        process.exit(1);
    }
    await initAgenticContainer();
    const report = buildCapabilityReport({ requestTokensMode: REQUEST_TOKENS_MODE });
    Logger.info(formatCapabilityReport(report));
    const artifactError = await publishCapabilityArtifact(report);
    if (artifactError) {
        Logger.error(`[agent-gateway] Refusing to serve: ${artifactError}`);
        process.exit(1);
    }
    const missing = findMissingRequired(report);
    if (missing.length > 0) {
        const summary = missing.map((m) => `${m.id}: ${m.detail}`).join('; ');
        if (requireAgentic()) {
            // Refusing to bind is the point. Serving anyway would produce a healthy
            // looking authorizer that silently skips its primary strategies.
            Logger.error(`[agent-gateway] Refusing to serve: ${missing.length} required capabilit(ies) are not live -- ${summary}. ` +
                'Set MASTYF_AGENT_GATEWAY_REQUIRE_AGENTIC=false to serve anyway and accept those strategies being skipped.');
            process.exit(1);
        }
        Logger.warn(`[agent-gateway] Serving with ${missing.length} required capabilit(ies) not live (MASTYF_AGENT_GATEWAY_REQUIRE_AGENTIC=false) -- ${summary}`);
    }
    const policyEngine = new PolicyEngine(policy);
    // No tokenizer prewarm here on purpose. The authorizer has no tokenizer and
    // must not acquire one: it sits on the authorization path where a BPE table
    // load would add latency and memory for a number that is only ever a guard
    // input. `estimateArgumentTokens` is a pure pass over the arguments, shared
    // with the engine so the two cannot drift. TokenCounter caches BPE tables per
    // instance, so warming one here would not warm the counter the proxy servers
    // use for real billing either.
    const server = createExternalProcessorServer({
        deps: { policyEngine },
        defaultServerName: process.env['MASTYF_AGENT_GATEWAY_SERVER_NAME'] ?? 'agent-gateway',
        defaultTenantId: process.env['MASTYF_AI_TENANT'] ?? 'default',
        decisionTimeoutMs: Number(process.env['MASTYF_AGENT_GATEWAY_DECISION_TIMEOUT_MS'] ?? 5_000),
    });
    // Cloud Run terminates TLS and speaks HTTP/2 to the container, so the process
    // itself listens on plaintext h2c.
    server.bindAsync(`0.0.0.0:${port}`, ServerCredentials.createInsecure(), (error, boundPort) => {
        if (error) {
            Logger.error(`[agent-gateway] Failed to bind: ${error.message}`);
            process.exit(1);
        }
        Logger.info(`[agent-gateway] ExternalProcessor listening on 0.0.0.0:${boundPort}`);
    });
    const shutdown = (signal) => () => {
        Logger.info(`[agent-gateway] ${signal} received; draining`);
        // A clean gRPC close tells the data plane to proceed without consulting us.
        // A request that is still mid-decision would therefore be *admitted*, not
        // refused, so it has to be destroyed (gRPC error = the failure path Envoy
        // honours) before the graceful drain starts. Verified against Envoy: a clean
        // close mid-request is a 200 even with failure_mode_allow: false.
        const destroyed = server.destroyUndecidedCalls(`agent-gateway shutdown (${signal})`);
        if (destroyed > 0) {
            Logger.warn(`[agent-gateway] Destroyed ${destroyed} in-flight request(s) without a verdict; ` +
                'the data plane will fail these closed');
        }
        // Flush the write-behind queue before exiting: writes are debounced by
        // MASTYF_AI_INDUSTRY_DEBOUNCE, so exiting immediately would drop every
        // certification/reputation/tier write still sitting in memory.
        const exit = () => {
            void getIndustryHotState()
                .shutdown()
                .catch((err) => {
                Logger.error(`[agent-gateway] agentic write-behind flush failed during shutdown: ${err instanceof Error ? err.message : String(err)}`);
            })
                .finally(() => process.exit(0));
        };
        server.tryShutdown(exit);
        // Do not let a hung stream keep the container alive past the grace period.
        // The second destroy catches calls that started while the drain was running.
        setTimeout(() => {
            server.destroyUndecidedCalls('agent-gateway shutdown grace period expired');
            exit();
        }, 10_000).unref();
    };
    process.on('SIGTERM', shutdown('SIGTERM'));
    process.on('SIGINT', shutdown('SIGINT'));
}
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    // `start` now initializes the agentic container, which is async. A failure here
    // must not leave the process alive but unserving, so the rejection is fatal
    // rather than an unhandled warning.
    start().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        Logger.error(`[agent-gateway] Startup failed: ${message}`);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map