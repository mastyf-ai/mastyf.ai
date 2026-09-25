import { Logger } from '../utils/logger.js';
import { isVulnDiscoveryEnabled } from './auth.js';
import { scanServerSupplyChain } from './supply-chain-scanner.js';
import { scanServerSast } from './sast-scanner.js';
import { probeUpstreamApis } from './upstream-api-prober.js';
import { fuzzMcpServers } from './mcp-fuzz-runner.js';
import { buildAgentStackGraph } from './stack-graph.js';
import { autoValidateEligible, validateFinding } from './validate.js';
import { analyzeFinding, onFindingValidated } from './vuln-analyst.js';
import { listFindings } from './store.js';
export async function runVulnDiscovery(opts) {
    const startedAt = new Date().toISOString();
    const scannersRun = [];
    const errors = [];
    const allFindings = [];
    if (!isVulnDiscoveryEnabled() && process.env.MASTYF_AI_VULN_DISCOVERY_FORCE !== 'true') {
        Logger.warn('[vuln-discovery] Disabled — set MASTYF_AI_VULN_DISCOVERY_ENABLED=true');
        return {
            summary: {
                startedAt,
                finishedAt: new Date().toISOString(),
                findingsCreated: 0,
                findingsValidated: 0,
                scannersRun: [],
                errors: ['disabled'],
            },
            findings: [],
            graph: buildAgentStackGraph(opts.servers, {
                toolsByServer: opts.toolsByServer,
                observedUrls: opts.upstreamUrls,
            }),
        };
    }
    for (const server of opts.servers) {
        try {
            scannersRun.push(`supply-chain:${server.name}`);
            const sc = await scanServerSupplyChain(server, { skipAudit: opts.skipAudit });
            allFindings.push(...sc.findings);
            errors.push(...sc.errors.map((e) => `${server.name}:${e}`));
        }
        catch (err) {
            errors.push(`supply-chain:${server.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!opts.supplyChainOnly && !opts.skipSast) {
            try {
                scannersRun.push(`sast:${server.name}`);
                const sast = await scanServerSast(server);
                allFindings.push(...sast);
            }
            catch (err) {
                errors.push(`sast:${server.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    const enableFuzz = !opts.skipFuzz
        && (opts.mcpFuzz === true || !opts.supplyChainOnly);
    if (enableFuzz) {
        scannersRun.push('mcp-tool-fuzzer');
        try {
            const fuzz = await fuzzMcpServers(opts.servers, {
                viaProxy: opts.viaProxy === true || process.env.MASTYF_AI_VULN_FUZZ_VIA_PROXY === 'true',
            });
            allFindings.push(...fuzz.findings);
            errors.push(...fuzz.errors);
            Logger.info(`[vuln-discovery] mcp-fuzz tools=${fuzz.toolsFuzzed} calls=${fuzz.callsMade} findings=${fuzz.findings.length}`);
        }
        catch (err) {
            errors.push(`mcp-fuzz: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (!opts.supplyChainOnly && !opts.skipUpstream && opts.upstreamUrls?.length) {
        scannersRun.push('upstream-api-prober');
        try {
            const results = await probeUpstreamApis(opts.upstreamUrls);
            for (const r of results) {
                allFindings.push(...r.findings);
                errors.push(...r.errors.map((e) => `upstream:${r.url}:${e}`));
            }
        }
        catch (err) {
            errors.push(`upstream: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    let validated = 0;
    if (opts.autoValidate !== false) {
        const results = autoValidateEligible();
        validated = results.filter((r) => r.promoted).length;
        if (opts.autoAnalyze !== false) {
            for (const r of results.filter((x) => x.promoted)) {
                try {
                    await onFindingValidated(r.finding.id);
                }
                catch (err) {
                    errors.push(`analyze:${r.finding.id}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
    }
    const graph = buildAgentStackGraph(opts.servers, {
        toolsByServer: opts.toolsByServer,
        observedUrls: opts.upstreamUrls,
    });
    const summary = {
        startedAt,
        finishedAt: new Date().toISOString(),
        findingsCreated: allFindings.length,
        findingsValidated: validated,
        scannersRun: [...new Set(scannersRun)],
        errors,
    };
    Logger.info(`[vuln-discovery] done findings=${allFindings.length} validated=${validated} errors=${errors.length}`);
    return { summary, findings: listFindings(), graph };
}
export { listFindings, validateFinding, analyzeFinding, isVulnDiscoveryEnabled, };
//# sourceMappingURL=engine.js.map