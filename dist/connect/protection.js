/**
 * The dashboard's protection switch. Off: agents and their MCP servers are only listed (read-only).
 * On: every local MCP server in every agent on this machine starts behind the Mastyf proxy, and any
 * server added later is picked up by itself. Turning it off restores the agents' own settings.
 *
 * The edits are `connect` / `disconnect`; this adds the stored on/off choice and the watcher.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanAgentInventory } from '../auto-discovery/agent-inventory.js';
import { Logger } from '../utils/logger.js';
import { KNOWN_AGENTS } from './agents.js';
import { connect, disconnect, readConnectState } from './connect.js';
const POLL_MS = 4000;
const MAX_EVENTS = 20;
export class ProtectionService {
    opts;
    timer = null;
    signature = '';
    events = [];
    notProtected = [];
    constructor(opts) {
        this.opts = opts;
    }
    get home() {
        return this.opts.home ?? os.homedir();
    }
    get file() {
        return path.join(this.home, '.mastyf-ai', 'protection.json');
    }
    scan() {
        return (this.opts.scan ?? scanAgentInventory)();
    }
    readChoice() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            return { enabled: raw.enabled === true, changedAt: raw.changedAt ?? null };
        }
        catch {
            return { enabled: false, changedAt: null };
        }
    }
    writeChoice(enabled) {
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(this.file, JSON.stringify({ enabled, changedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
    }
    log(event) {
        this.events = [{ at: new Date().toISOString(), ...event }, ...this.events].slice(0, MAX_EVENTS);
    }
    /** Size and time of every agent settings file, so a poll that finds nothing new costs a few stats. */
    currentSignature() {
        const parts = [];
        for (const agent of KNOWN_AGENTS) {
            for (const p of agent.configPaths(this.home)) {
                try {
                    const s = fs.statSync(p);
                    parts.push(`${p}:${s.mtimeMs}:${s.size}`);
                }
                catch {
                    /* not installed */
                }
            }
        }
        return parts.join('|');
    }
    apply() {
        const result = connect({
            home: this.home,
            projectRoot: this.opts.projectRoot,
            nodeCommand: this.opts.nodeCommand ?? process.execPath,
        });
        for (const c of result.connected)
            this.log({ kind: 'protected', agent: c.id, servers: c.wrapped });
        for (const f of result.failed)
            this.log({ kind: 'failed', agent: f.id, message: f.reason });
        this.notProtected = result.notProtected;
        this.signature = this.currentSignature();
    }
    /** One watcher step: when an agent's settings changed, protect anything new in them. */
    tick() {
        if (!this.readChoice().enabled)
            return;
        const now = this.currentSignature();
        if (now === this.signature)
            return;
        try {
            this.apply();
        }
        catch (err) {
            this.signature = now;
            this.log({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
        }
    }
    /** Resume watching if protection was left on. Does nothing until the user turns it on. */
    start() {
        if (this.timer || !this.readChoice().enabled)
            return;
        this.tick();
        this.timer = setInterval(() => {
            try {
                this.tick();
            }
            catch (err) {
                Logger.warn(`[protection] ${err instanceof Error ? err.message : String(err)}`);
            }
        }, POLL_MS);
        this.timer.unref();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    enable() {
        this.writeChoice(true);
        this.log({ kind: 'on' });
        this.signature = '';
        this.start();
        return this.status();
    }
    disable() {
        this.stop();
        this.writeChoice(false);
        const out = disconnect({ home: this.home });
        this.notProtected = [];
        this.log({ kind: 'off' });
        if (out.restored.length)
            this.log({ kind: 'restored', servers: out.restored });
        if (out.failed.length)
            this.log({ kind: 'failed', servers: out.failed, message: 'Could not restore these; turn protection off again once their settings file can be read.' });
        return this.status();
    }
    status() {
        const inv = this.scan();
        const state = readConnectState(this.home);
        const choice = this.readChoice();
        const ours = new Set((state?.agents ?? []).flatMap((a) => Object.keys(a.originals).map((n) => `${a.id}\n${n}`)));
        return {
            ...choice,
            watching: this.timer !== null,
            lastScanAt: inv.scannedAt,
            agents: inv.agents.map((a) => ({
                ...a,
                servers: a.servers.map((s) => ({ ...s, via: !s.protected ? null : ours.has(`${a.id}\n${s.name}`) ? 'mastyf' : 'other' })),
            })),
            totals: inv.totals,
            notProtected: this.notProtected,
            events: this.events,
        };
    }
}
let service = null;
export function getProtectionService(projectRoot) {
    service ??= new ProtectionService({ projectRoot });
    return service;
}
//# sourceMappingURL=protection.js.map