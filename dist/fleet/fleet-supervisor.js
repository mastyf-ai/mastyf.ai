import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { discoverAllServers, materializeRemoteFleetManifest, materializeServerConfig, isStdioUpstream, isRemoteUpstream, } from './unified-server-registry.js';
import { allocateFleetPorts, clearFleetState, FLEET_ADMIN_PORT, localIngressUrl, readFleetState, writeFleetState, } from './fleet-state.js';
import { patchClientToLocalUrls } from '../wrap/client-wrap.js';
import { resolveMastyfAiInstallRoot } from '../utils/mastyf-ai-package-root.js';
import { applyStartEnv } from '../utils/start-env.js';
import { Logger } from '../utils/logger.js';
let activeSupervisor = null;
export class FleetSupervisor {
    opts;
    children = [];
    adminServer = null;
    installRoot;
    workspaceRoot;
    policyPath;
    blockingMode;
    client;
    applyIde;
    constructor(opts = {}) {
        this.opts = opts;
        this.installRoot = resolve(opts.installRoot ?? resolveMastyfAiInstallRoot());
        this.workspaceRoot = resolve(opts.workspaceRoot ?? process.cwd());
        this.policyPath = opts.policyPath ?? join(this.installRoot, 'policy-audit.yaml');
        this.blockingMode = opts.blockingMode ?? process.env.MASTYF_AI_BLOCKING_MODE ?? 'block';
        this.client = opts.client ?? 'auto';
        this.applyIde = opts.applyIde !== false;
    }
    async start() {
        await this.stop();
        activeSupervisor = this;
        const entries = discoverAllServers({
            workspaceRoot: this.workspaceRoot,
            includeIde: this.opts.includeIde !== false,
        });
        if (entries.length === 0) {
            throw new Error('No MCP servers discovered. Add servers in the dashboard, run mastyf-ai onboard, or configure your IDE MCP settings.');
        }
        const stdioEntries = entries.filter(isStdioUpstream);
        const remoteEntries = entries.filter(isRemoteUpstream);
        const portNames = [
            ...stdioEntries.map((e) => e.name),
            ...remoteEntries.map((e) => e.name),
        ];
        const prior = readFleetState();
        const ports = allocateFleetPorts(portNames, prior);
        const distCli = join(this.installRoot, 'dist', 'cli.js');
        if (!existsSync(distCli)) {
            throw new Error(`Missing ${distCli} — run pnpm build or mastyf-ai setup`);
        }
        const fleetServers = [];
        const urlPatches = [];
        let dashboardAssigned = false;
        for (const entry of stdioEntries) {
            const configPath = entry.configPath ?? materializeServerConfig(entry, this.workspaceRoot);
            const port = ports.get(entry.name);
            const localUrl = localIngressUrl(port, 'streamable');
            const enableDashboard = !dashboardAssigned;
            if (enableDashboard)
                dashboardAssigned = true;
            const child = this.spawnProxyChild({
                configPath,
                exposeLocalPort: port,
                enableDashboard,
                serverName: entry.name,
            });
            this.children.push({
                name: entry.name,
                process: child,
                port,
                transport: 'stdio',
                configPath,
                localUrl,
            });
            fleetServers.push({
                name: entry.name,
                pid: child.pid ?? 0,
                port,
                transport: 'stdio',
                status: 'running',
                localUrl,
                configPath,
            });
            urlPatches.push({ name: entry.name, localUrl });
        }
        if (remoteEntries.length > 0) {
            const remotePorts = new Map();
            for (const e of remoteEntries) {
                remotePorts.set(e.name, ports.get(e.name));
            }
            const manifestPath = materializeRemoteFleetManifest(remoteEntries, this.workspaceRoot, remotePorts);
            const enableDashboard = !dashboardAssigned;
            if (enableDashboard)
                dashboardAssigned = true;
            const child = this.spawnProxyChild({
                configPath: manifestPath,
                enableDashboard,
                serverName: 'remote-fleet',
                unsafeNoTls: true,
            });
            this.children.push({
                name: '__remote_coordinator__',
                process: child,
                transport: 'remote-coordinator',
                configPath: manifestPath,
            });
            for (const entry of remoteEntries) {
                const port = ports.get(entry.name);
                const localUrl = localIngressUrl(port, entry.transport === 'streamable' ? 'streamable' : 'sse');
                fleetServers.push({
                    name: entry.name,
                    pid: child.pid ?? 0,
                    port,
                    transport: entry.transport === 'streamable' ? 'streamable' : 'sse',
                    status: 'running',
                    localUrl,
                    configPath: manifestPath,
                });
                urlPatches.push({ name: entry.name, localUrl });
            }
        }
        if (this.applyIde && urlPatches.length > 0) {
            try {
                const patch = patchClientToLocalUrls({
                    client: this.client,
                    entries: urlPatches,
                    apply: true,
                });
                if (patch.patched.length > 0) {
                    console.log(chalk.green(`  IDE patched (${patch.patched.join(', ')}) — reload MCP in your IDE`));
                }
            }
            catch (err) {
                console.log(chalk.yellow(`  IDE patch skipped: ${err instanceof Error ? err.message : String(err)}`));
            }
        }
        const state = {
            servers: fleetServers,
            startedAt: new Date().toISOString(),
            adminPort: FLEET_ADMIN_PORT,
            workspaceRoot: this.workspaceRoot,
            policyPath: this.policyPath,
        };
        writeFleetState(state);
        await this.startAdminServer();
        console.log(chalk.bold('\n  Fleet Hub — all servers protected\n'));
        for (const s of fleetServers) {
            console.log(chalk.dim(`    ${s.name}: ${s.localUrl}`));
        }
        const dashPort = process.env.DASHBOARD_PORT || '4000';
        console.log(chalk.cyan(`\n  Dashboard: http://localhost:${dashPort}/\n`));
        return state;
    }
    async stop() {
        if (this.adminServer) {
            await new Promise((r) => this.adminServer.close(() => r()));
            this.adminServer = null;
        }
        for (const child of this.children) {
            try {
                child.process.kill('SIGTERM');
            }
            catch {
                /* ignore */
            }
        }
        this.children = [];
        if (activeSupervisor === this)
            activeSupervisor = null;
    }
    async addServer(entry) {
        const configPath = materializeServerConfig(entry, this.workspaceRoot);
        const prior = readFleetState();
        const ports = allocateFleetPorts([entry.name], prior);
        const port = ports.get(entry.name);
        if (isStdioUpstream(entry)) {
            const localUrl = localIngressUrl(port, 'streamable');
            const child = this.spawnProxyChild({
                configPath,
                exposeLocalPort: port,
                enableDashboard: false,
                serverName: entry.name,
            });
            this.children.push({
                name: entry.name,
                process: child,
                port,
                transport: 'stdio',
                configPath,
                localUrl,
            });
            this.updateFleetStateEntry({
                name: entry.name,
                pid: child.pid ?? 0,
                port,
                transport: 'stdio',
                status: 'running',
                localUrl,
                configPath,
            });
            if (this.applyIde) {
                patchClientToLocalUrls({
                    client: this.client,
                    entries: [{ name: entry.name, localUrl }],
                    apply: true,
                });
            }
            return { localUrl, reloadRequired: true };
        }
        // Remote: restart coordinator with updated manifest
        await this.restartRemoteCoordinator();
        const state = readFleetState();
        const remote = state?.servers.find((s) => s.name === entry.name);
        return { localUrl: remote?.localUrl ?? '', reloadRequired: true };
    }
    async removeServer(name) {
        const idx = this.children.findIndex((c) => c.name === name);
        if (idx >= 0) {
            this.children[idx].process.kill('SIGTERM');
            this.children.splice(idx, 1);
        }
        const state = readFleetState();
        if (state) {
            state.servers = state.servers.filter((s) => s.name !== name);
            writeFleetState(state);
        }
    }
    async restartRemoteCoordinator() {
        const coordIdx = this.children.findIndex((c) => c.name === '__remote_coordinator__');
        if (coordIdx >= 0) {
            this.children[coordIdx].process.kill('SIGTERM');
            this.children.splice(coordIdx, 1);
        }
        const entries = discoverAllServers({ workspaceRoot: this.workspaceRoot });
        const remoteEntries = entries.filter(isRemoteUpstream);
        if (remoteEntries.length === 0)
            return;
        const prior = readFleetState();
        const ports = allocateFleetPorts(remoteEntries.map((e) => e.name), prior);
        const manifestPath = materializeRemoteFleetManifest(remoteEntries, this.workspaceRoot, ports);
        const child = this.spawnProxyChild({
            configPath: manifestPath,
            enableDashboard: this.children.every((c) => !c.name.includes('dashboard')),
            serverName: 'remote-fleet',
            unsafeNoTls: true,
        });
        this.children.push({
            name: '__remote_coordinator__',
            process: child,
            transport: 'remote-coordinator',
            configPath: manifestPath,
        });
        const state = readFleetState() ?? {
            servers: [],
            startedAt: new Date().toISOString(),
            adminPort: FLEET_ADMIN_PORT,
            workspaceRoot: this.workspaceRoot,
            policyPath: this.policyPath,
        };
        state.servers = state.servers.filter((s) => !remoteEntries.some((r) => r.name === s.name));
        for (const entry of remoteEntries) {
            const port = ports.get(entry.name);
            state.servers.push({
                name: entry.name,
                pid: child.pid ?? 0,
                port,
                transport: entry.transport === 'streamable' ? 'streamable' : 'sse',
                status: 'running',
                localUrl: localIngressUrl(port, entry.transport === 'streamable' ? 'streamable' : 'sse'),
                configPath: manifestPath,
            });
        }
        writeFleetState(state);
    }
    updateFleetStateEntry(entry) {
        const state = readFleetState();
        if (!state)
            return;
        const idx = state.servers.findIndex((s) => s.name === entry.name);
        if (idx >= 0)
            state.servers[idx] = entry;
        else
            state.servers.push(entry);
        writeFleetState(state);
    }
    spawnProxyChild(opts) {
        const distCli = join(this.installRoot, 'dist', 'cli.js');
        const args = [
            distCli,
            'proxy',
            '--config',
            opts.configPath,
            '--policy',
            this.policyPath,
            '--blocking-mode',
            this.blockingMode,
        ];
        if (opts.exposeLocalPort) {
            args.push('--expose-local-port', String(opts.exposeLocalPort));
        }
        if (opts.unsafeNoTls) {
            args.push('--unsafe-no-tls');
        }
        const env = { ...process.env };
        env.MASTYF_AI_FLEET_CHILD = 'true';
        env.DASHBOARD_ENABLED = opts.enableDashboard ? 'true' : 'false';
        env.METRICS_ENABLED = opts.enableDashboard ? 'true' : 'false';
        env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM = opts.unsafeNoTls ? 'true' : (env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM ?? 'true');
        const child = spawn(process.execPath, args, {
            cwd: this.installRoot,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });
        child.stdout?.on('data', (buf) => {
            const line = String(buf).trim();
            if (line)
                Logger.info(`[fleet:${opts.serverName}] ${line}`);
        });
        child.stderr?.on('data', (buf) => {
            const line = String(buf).trim();
            if (line)
                Logger.info(`[fleet:${opts.serverName}] ${line}`);
        });
        return child;
    }
    async startAdminServer() {
        this.adminServer = createServer((req, res) => {
            void this.handleAdmin(req, res);
        });
        await new Promise((resolve, reject) => {
            this.adminServer.once('error', reject);
            this.adminServer.listen(FLEET_ADMIN_PORT, '127.0.0.1', () => {
                this.adminServer.removeListener('error', reject);
                resolve();
            });
        });
    }
    async handleAdmin(req, res) {
        const url = (req.url || '/').split('?')[0];
        const method = req.method || 'GET';
        const json = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        if (url === '/status' && method === 'GET') {
            const entries = discoverAllServers({ workspaceRoot: this.workspaceRoot });
            const state = readFleetState();
            json(200, { entries, fleet: state, running: this.children.length });
            return;
        }
        if (url === '/stop' && method === 'POST') {
            await this.stop();
            clearFleetState();
            json(200, { ok: true });
            return;
        }
        if (url === '/restart' && method === 'POST') {
            const state = await this.start();
            json(200, { ok: true, fleet: state });
            return;
        }
        json(404, { error: 'Not found' });
    }
}
// Fix reference to opts in start() - I used opts.includeIde but should be this.opts
// Let me fix the fleet-supervisor - I have a bug: `opts.includeIde` should be `this.opts.includeIde`
export function getActiveSupervisor() {
    return activeSupervisor;
}
export async function runFleetSupervisor(opts = {}) {
    applyStartEnv();
    const supervisor = new FleetSupervisor(opts);
    await supervisor.start();
    const cleanup = async () => {
        await supervisor.stop();
        clearFleetState();
        process.exit(0);
    };
    process.on('SIGINT', () => void cleanup());
    process.on('SIGTERM', () => void cleanup());
    await new Promise(() => { });
    return undefined;
}
export async function fleetAdminRequest(path, method = 'GET') {
    const res = await fetch(`http://127.0.0.1:${FLEET_ADMIN_PORT}${path}`, { method });
    return res.json();
}
//# sourceMappingURL=fleet-supervisor.js.map