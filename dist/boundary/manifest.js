/**
 * Boundary Manifest Parser & Loader.
 *
 * Defines the expected security boundaries, network routes,
 * protected services, and credential isolation invariants.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
export function getDefaultBoundaryManifest() {
    return {
        version: '1',
        deployment: {
            name: 'local-agent-deployment',
            environment: 'local',
            platform: process.platform,
        },
        agent: {
            identity: 'coding-agent-01',
            network: 'agent-net',
            allowedCapabilities: ['filesystem.read', 'tool.call'],
            restrictedEnv: [
                'DATABASE_URL',
                'POSTGRES_PASSWORD',
                'AWS_SECRET_ACCESS_KEY',
                'GITHUB_TOKEN',
                'OPENAI_API_KEY',
                'ANTHROPIC_API_KEY',
            ],
        },
        protectedServices: [
            {
                name: 'production-db',
                endpoint: 'postgres.internal:5432',
                protocol: 'postgres',
                requiredAuth: 'mastyf-workload-identity',
            },
            {
                name: 'cmq-canary-mcp',
                endpoint: 'mcp-canary.internal:3000',
                protocol: 'mcp',
                requiredAuth: 'mastyf-signed-token',
            },
            {
                name: 'cmq-canary-api',
                endpoint: 'api-canary.internal:8080',
                protocol: 'http',
                requiredAuth: 'mastyf-bearer-identity',
            },
        ],
        mediation: {
            gateway: 'mastyf',
            allowedIngress: ['agent-net'],
            allowedEgress: ['mastyf-net'],
            failClosed: true,
            mTLS: true,
        },
        credentials: {
            agentAccess: 'none',
            gatewayAccess: ['vault:mastyf/production-db', 'vault:mastyf/github-token'],
            canaryToken: 'CMQ_CANARY_SECRET_7F91',
        },
    };
}
export function loadBoundaryManifest(explicitPath) {
    const candidatePaths = [
        explicitPath,
        path.join(process.cwd(), 'boundary.yaml'),
        path.join(process.cwd(), 'boundary.yml'),
        path.join(process.cwd(), 'mastyf-boundary.yaml'),
        path.join(process.cwd(), 'mastyf-boundary.yml'),
        path.join(process.cwd(), '.mastyf/boundary.yaml'),
    ].filter(Boolean);
    for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
            try {
                const raw = fs.readFileSync(candidate, 'utf-8');
                const parsed = yaml.load(raw);
                return validateAndMergeManifest(parsed);
            }
            catch (err) {
                throw new Error(`Failed to parse boundary manifest at ${candidate}: ${String(err)}`);
            }
        }
    }
    return getDefaultBoundaryManifest();
}
export function validateAndMergeManifest(parsed) {
    const defaultManifest = getDefaultBoundaryManifest();
    return {
        version: String(parsed.version || defaultManifest.version),
        deployment: {
            name: String(parsed.deployment?.name || defaultManifest.deployment.name),
            environment: String(parsed.deployment?.environment || defaultManifest.deployment.environment),
            platform: String(parsed.deployment?.platform || defaultManifest.deployment.platform),
        },
        agent: {
            identity: String(parsed.agent?.identity || defaultManifest.agent.identity),
            network: parsed.agent?.network || defaultManifest.agent.network,
            allowedCapabilities: parsed.agent?.allowedCapabilities || defaultManifest.agent.allowedCapabilities,
            restrictedEnv: parsed.agent?.restrictedEnv || defaultManifest.agent.restrictedEnv,
        },
        protectedServices: Array.isArray(parsed.protectedServices) && parsed.protectedServices.length > 0
            ? parsed.protectedServices
            : defaultManifest.protectedServices,
        mediation: {
            gateway: String(parsed.mediation?.gateway || defaultManifest.mediation.gateway),
            allowedIngress: parsed.mediation?.allowedIngress || defaultManifest.mediation.allowedIngress,
            allowedEgress: parsed.mediation?.allowedEgress || defaultManifest.mediation.allowedEgress,
            failClosed: parsed.mediation?.failClosed !== undefined ? Boolean(parsed.mediation.failClosed) : true,
            mTLS: parsed.mediation?.mTLS !== undefined ? Boolean(parsed.mediation.mTLS) : true,
            udsSocketPath: parsed.mediation?.udsSocketPath,
        },
        credentials: {
            agentAccess: parsed.credentials?.agentAccess || 'none',
            gatewayAccess: parsed.credentials?.gatewayAccess || defaultManifest.credentials.gatewayAccess,
            canaryToken: parsed.credentials?.canaryToken || defaultManifest.credentials.canaryToken,
        },
    };
}
//# sourceMappingURL=manifest.js.map