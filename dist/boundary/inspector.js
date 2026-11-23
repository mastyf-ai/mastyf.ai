/**
 * CMQ Topology Inspector.
 *
 * Implements Level 1 (Declarative) and Level 2 (Environmental) evidence gathering:
 * 1. Prohibited credentials leaked into agent environment.
 * 2. Unmediated direct listening sockets and active direct route probing.
 * 3. Shell and subprocess escape surface.
 * 4. Local filesystem permissions on secret stores (~/.ssh, ~/.aws, /var/run/secrets).
 * 5. Docker network and Kubernetes namespace isolation inspection.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
const SENSITIVE_ENV_KEYS = [
    'DATABASE_URL',
    'POSTGRES_PASSWORD',
    'MYSQL_PWD',
    'AWS_SECRET_ACCESS_KEY',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'SLACK_BOT_TOKEN',
    'VAULT_TOKEN',
];
const SENSITIVE_FILE_PATHS = [
    path.join(os.homedir(), '.ssh/id_rsa'),
    path.join(os.homedir(), '.ssh/id_ed25519'),
    path.join(os.homedir(), '.aws/credentials'),
    path.join(os.homedir(), '.kube/config'),
    '/var/run/secrets/kubernetes.io/serviceaccount/token',
    '/var/run/docker.sock',
];
/**
 * Actively probe whether a direct TCP connection can be established from the agent's
 * current network environment to a protected endpoint without going through Mastyf.
 */
async function probeDirectSocket(endpoint, timeoutMs = 400) {
    return new Promise((resolve) => {
        try {
            let host = endpoint;
            let port = 80;
            if (endpoint.includes('://')) {
                const u = new URL(endpoint);
                host = u.hostname;
                port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
            }
            else if (endpoint.includes(':')) {
                const parts = endpoint.split(':');
                host = parts[0];
                port = parseInt(parts[1], 10) || 80;
            }
            if (!host || isNaN(port)) {
                return resolve(false);
            }
            const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
                socket.destroy();
                resolve(true); // Direct route OPEN
            });
            socket.on('error', () => {
                socket.destroy();
                resolve(false);
            });
            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });
        }
        catch {
            resolve(false);
        }
    });
}
export async function inspectTopology(manifest, agentEnv) {
    const envToInspect = agentEnv !== undefined ? agentEnv : process.env;
    const findings = [];
    let directRoutesDetected = 0;
    let credentialPathsDetected = 0;
    let protectedEndpointsExposed = 0;
    // ─────────────────────────────────────────────────────────────────────────────
    // LEVEL 1: Declarative Inspection (Manifest Consistency)
    // ─────────────────────────────────────────────────────────────────────────────
    // 1.1 Fail-Closed Configuration
    if (manifest.mediation.failClosed) {
        findings.push({
            id: 'FINDING-DEC-FAILCLOSED',
            level: 'LEVEL_1_DECLARATIVE',
            category: 'network',
            title: 'Mediation Declared as Fail-Closed',
            severity: 'PASS',
            detail: 'Manifest specifies failClosed: true. If Mastyf terminates or crashes, tool calls will abort rather than falling back to direct connection.',
        });
    }
    else {
        findings.push({
            id: 'FINDING-DEC-FAILOPEN',
            level: 'LEVEL_1_DECLARATIVE',
            category: 'network',
            title: 'Fail-Open Vulnerability Declared in Manifest',
            severity: 'FAIL',
            detail: 'Manifest declares failClosed: false. Agent is configured to bypass gateway if Mastyf is unresponsive.',
            remediation: 'Set mediation.failClosed: true in boundary manifest.',
        });
    }
    // 1.2 Declarative Workload Identity Attestation
    const protectedServices = manifest.protectedServices || [];
    for (const s of protectedServices) {
        if (!s.expectedWorkloadIdentity) {
            findings.push({
                id: `FINDING-DEC-IDENTITY-${s.name}`,
                level: 'LEVEL_1_DECLARATIVE',
                category: 'network',
                title: `Service "${s.name}" Lacks Workload Identity Specification`,
                severity: 'WARN',
                detail: `Protected service "${s.name}" does not specify expectedWorkloadIdentity (e.g. SPIFFE ID, mTLS SAN, or signed header). Protected tool cannot cryptographically verify requests originated from Mastyf Gateway.`,
                remediation: `Configure expectedWorkloadIdentity in boundary manifest under protectedServices.${s.name}.`,
            });
        }
        else {
            findings.push({
                id: `FINDING-DEC-IDENTITY-${s.name}-OK`,
                level: 'LEVEL_1_DECLARATIVE',
                category: 'network',
                title: `Service "${s.name}" Binds Workload Identity`,
                severity: 'PASS',
                detail: `Protected service expects verified workload identity "${s.expectedWorkloadIdentity}".`,
            });
        }
    }
    // ─────────────────────────────────────────────────────────────────────────────
    // LEVEL 2: Environmental Inspection (Real Runtime & Host Verification)
    // ─────────────────────────────────────────────────────────────────────────────
    // 2.1 Inspect Environment Credentials
    const restrictedKeys = manifest.agent.restrictedEnv || SENSITIVE_ENV_KEYS;
    const foundLeakedKeys = [];
    for (const key of restrictedKeys) {
        if (envToInspect[key] && String(envToInspect[key]).trim().length > 0) {
            foundLeakedKeys.push(key);
        }
    }
    if (foundLeakedKeys.length > 0) {
        credentialPathsDetected += foundLeakedKeys.length;
        findings.push({
            id: 'FINDING-ENV-CRED-01',
            level: 'LEVEL_2_ENVIRONMENTAL',
            category: 'credentials',
            title: 'Sensitive Credentials Discovered in Agent Process Environment',
            severity: 'FAIL',
            detail: `Agent environment contains ${foundLeakedKeys.length} sensitive secrets (${foundLeakedKeys.join(', ')}). An attacker or confabulating model can independently authenticate directly to protected infrastructure without passing through Mastyf.`,
            remediation: 'Strip credentials from agent process/container; inject authority exclusively through Mastyf Gateway headers or Vault integration.',
        });
    }
    else {
        findings.push({
            id: 'FINDING-ENV-CRED-00',
            level: 'LEVEL_2_ENVIRONMENTAL',
            category: 'credentials',
            title: 'Agent Process Credential Isolation Verified',
            severity: 'PASS',
            detail: 'No prohibited database, cloud, or API secrets discovered in agent process environment variables.',
        });
    }
    // 2.2 Inspect Filesystem & Secret Store Accessibility
    const exposedFiles = [];
    for (const fp of SENSITIVE_FILE_PATHS) {
        try {
            if (fs.existsSync(fp)) {
                fs.accessSync(fp, fs.constants.R_OK);
                exposedFiles.push(fp);
            }
        }
        catch {
            // Inaccessible - good
        }
    }
    if (exposedFiles.length > 0) {
        credentialPathsDetected += exposedFiles.length;
        findings.push({
            id: 'FINDING-ENV-FS-01',
            level: 'LEVEL_2_ENVIRONMENTAL',
            category: 'filesystem',
            title: 'Mounted Secret Stores Accessible by Agent Sandbox',
            severity: 'WARN',
            detail: `Agent has read access to host credentials: ${exposedFiles.join(', ')}.`,
            remediation: 'Apply container mount masking or restrict Unix file permissions (chmod 600 or unmount in sandbox).',
        });
    }
    else {
        findings.push({
            id: 'FINDING-ENV-FS-00',
            level: 'LEVEL_2_ENVIRONMENTAL',
            category: 'filesystem',
            title: 'Secret Stores Protected Against Direct Access',
            severity: 'PASS',
            detail: 'No host SSH, AWS, or Kubernetes service account tokens directly accessible in agent sandbox.',
        });
    }
    // 2.3 Environmental Docker / Container Inspection
    try {
        if (fs.existsSync('/var/run/docker.sock')) {
            findings.push({
                id: 'FINDING-ENV-DOCKER-SOCK',
                level: 'LEVEL_2_ENVIRONMENTAL',
                category: 'socket',
                title: 'Docker Daemon Socket Exposed to Agent',
                severity: 'FAIL',
                detail: 'The host Docker socket (/var/run/docker.sock) is directly accessible. An agent can spawn arbitrary privileged containers and bypass all network and file isolation.',
                remediation: 'Unmount /var/run/docker.sock from the agent container volume mounts.',
            });
            directRoutesDetected++;
        }
    }
    catch {
        // ignore
    }
    // 2.4 Environmental Kubernetes NetworkPolicy & Service Account Checks
    const inK8s = fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount');
    if (inK8s) {
        findings.push({
            id: 'FINDING-ENV-K8S-RUNTIME',
            level: 'LEVEL_2_ENVIRONMENTAL',
            category: 'network',
            title: 'Running in Kubernetes Pod',
            severity: 'PASS',
            detail: 'Kubernetes runtime detected. Enforce strict namespace-isolated NetworkPolicy.',
        });
    }
    // 2.5 Active Direct Route Probing to Protected Endpoints
    // Crucial rule: Even if manifest claims isolation, verify whether a direct TCP socket can be opened.
    for (const s of protectedServices) {
        const isLoopback = s.endpoint.includes('localhost') || s.endpoint.includes('127.0.0.1');
        if (isLoopback) {
            protectedEndpointsExposed++;
            findings.push({
                id: `FINDING-ENV-LOOPBACK-${s.name}`,
                level: 'LEVEL_2_ENVIRONMENTAL',
                category: 'network',
                title: `Service "${s.name}" shares Loopback with Agent`,
                severity: 'WARN',
                detail: `Protected endpoint ${s.endpoint} shares the same network loopback as the agent. Direct bypass is possible unless protected tool enforces Mastyf Workload Identity.`,
                remediation: 'Deploy agent and protected tool on isolated bridge networks or distinct Kubernetes namespaces.',
            });
        }
        // Active socket connectivity check
        // If endpoint is live and reachable directly without proxying:
        const directRouteOpen = await probeDirectSocket(s.endpoint);
        if (directRouteOpen) {
            directRoutesDetected++;
            findings.push({
                id: `FINDING-ENV-ACTIVE-ROUTE-${s.name}`,
                level: 'LEVEL_2_ENVIRONMENTAL',
                category: 'network',
                title: `Direct Network Route OPEN to Protected Service "${s.name}"`,
                severity: 'FAIL',
                detail: `Direct TCP probe to "${s.endpoint}" succeeded from the agent execution context. The agent has an active unmediated network path to the protected system!`,
                remediation: `Configure dual Docker networks or Kubernetes NetworkPolicy to deny direct agent egress to ${s.endpoint}.`,
            });
        }
        else {
            findings.push({
                id: `FINDING-ENV-ROUTE-${s.name}-BLOCKED`,
                level: 'LEVEL_2_ENVIRONMENTAL',
                category: 'network',
                title: `Direct Route to "${s.name}" Not Accessible`,
                severity: 'PASS',
                detail: `Direct unmediated connection to ${s.endpoint} was rejected or unreachable from the agent environment.`,
            });
        }
    }
    // 2.6 Shell & Subprocess Escape Surface
    const allowedCaps = manifest.agent.allowedCapabilities || [];
    const hasShellCap = allowedCaps.some((c) => c.includes('shell') || c.includes('terminal') || c.includes('exec'));
    if (hasShellCap) {
        findings.push({
            id: 'FINDING-ENV-SHELL-01',
            level: 'LEVEL_2_ENVIRONMENTAL',
            category: 'shell',
            title: 'Agent Possesses Shell / Command Execution Capability',
            severity: 'WARN',
            detail: 'Agent has execution capabilities that could be used to launch unmediated network sockets or curl child processes.',
            remediation: 'Constrain tool capability to CBAC digital hall-passes and enforce network egress filtering.',
        });
    }
    else {
        findings.push({
            id: 'FINDING-ENV-SHELL-00',
            level: 'LEVEL_2_ENVIRONMENTAL',
            category: 'shell',
            title: 'Shell Execution Capability Restricted',
            severity: 'PASS',
            detail: 'Agent manifest does not grant unrestricted shell or terminal execution capabilities.',
        });
    }
    const passCount = findings.filter((f) => f.severity === 'PASS').length;
    const warnCount = findings.filter((f) => f.severity === 'WARN').length;
    const failCount = findings.filter((f) => f.severity === 'FAIL').length;
    let verdict = 'INSPECT_PASSED';
    if (failCount > 0 || directRoutesDetected > 0) {
        verdict = 'INSPECT_FAILED';
    }
    else if (warnCount > 0) {
        verdict = 'INSPECT_WARNING';
    }
    return {
        timestamp: new Date().toISOString(),
        deploymentName: manifest.deployment.name,
        platform: manifest.deployment.platform || process.platform,
        checksCount: findings.length,
        passCount,
        warnCount,
        failCount,
        directRoutesDetected,
        credentialPathsDetected,
        protectedEndpointsExposed,
        verdict,
        findings,
    };
}
//# sourceMappingURL=inspector.js.map