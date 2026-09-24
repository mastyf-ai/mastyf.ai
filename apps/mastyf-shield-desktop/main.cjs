/**
 * Mastyf Shield — Electron desktop shell (macOS-first).
 *
 * Process supervisor + BrowserWindow only.
 * Security authority remains Python Gateway + Node BFF.
 * Electron never evaluates CBAC/DIFC/Workflow/AIA or dispatches MCP bytes.
 *
 * CommonJS entry — Electron 33 + "type":"module" main.mjs fails to boot
 * (cjsPreparseModuleExports / undefined exports).
 */

'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, session } = require('electron');
const { spawn } = require('node:child_process');
const {
  createWriteStream,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { homedir, hostname, userInfo } = require('node:os');
const { join, resolve } = require('node:path');
const { pipeline } = require('node:stream/promises');
const { resolveApplianceHomes, resolveAutostart } = require('./resolve-appliance-homes.cjs');
const { resolveAppliancePorts, evaluateForeignStack } = require('./resolve-appliance-ports.cjs');
const { resolveStackLayout, evaluatePackagedStack } = require('./resolve-stack.cjs');
const licenseLocal = require('./license-local.cjs');

if (app.isPackaged) {
  app.setName('Mastyf Shield');
}

const REPO_ROOT = resolve(__dirname, '../..');
const GUARD_MODEL = process.env.MASTYF_AIA_OLLAMA_MODEL || 'mastyf-guard-v6';
let guardCreateAttempted = false;
let guardDownloadAttempted = false;
/** Prevent restart storms while quitting */
let quitting = false;
/** Crash-recovery backoff for managed children (ms) */
let gatewayRestartBackoffMs = 1000;
let bffRestartBackoffMs = 1000;
/** @type {ReturnType<typeof setInterval> | null} */
let healthMonitorTimer = null;

const initialPorts = resolveAppliancePorts({
  packaged: Boolean(app.isPackaged),
  env: process.env,
});
let GATEWAY_PORT = initialPorts.gatewayPort;
let BFF_PORT = initialPorts.bffPort;
let UI_URL = '';

function refreshRuntimeEndpoints() {
  const ports = resolveAppliancePorts({ packaged: Boolean(app.isPackaged), env: process.env });
  GATEWAY_PORT = ports.gatewayPort;
  BFF_PORT = ports.bffPort;
  if (app.isPackaged) {
    UI_URL = process.env.MASTYF_SHIELD_UI_URL || `http://127.0.0.1:${BFF_PORT}`;
  } else {
    UI_URL =
      process.env.MASTYF_SHIELD_UI_URL ||
      process.env.MASTYF_APPLIANCE_URL ||
      'http://localhost:3000';
  }
}
refreshRuntimeEndpoints();

/** Deep-link targets — matches MastyfApplianceShell URLSearchParams (mode/tab). */
function deepLinks() {
  const base = UI_URL.replace(/\/$/, '');
  return {
    shield: process.env.MASTYF_SHIELD_DEEP_SHIELD || `${base}/?mode=shield`,
    access:
      process.env.MASTYF_SHIELD_DEEP_ACCESS || `${base}/?mode=security-center&tab=access`,
    ask: process.env.MASTYF_SHIELD_DEEP_ASK || `${base}/?mode=security-center&tab=ask`,
  };
}

function resolveStartupUrl() {
  const links = deepLinks();
  const deep = String(process.env.MASTYF_SHIELD_DEEP_LINK || 'shield').toLowerCase();
  if (deep === 'ask') return links.ask;
  if (deep === 'access' || deep === 'security' || deep === 'security-center' || deep === 'ai-access') {
    return links.access;
  }
  return links.shield;
}

function stackLayout() {
  return resolveStackLayout({
    packaged: Boolean(app.isPackaged),
    resourcesPath: process.resourcesPath,
    repoRoot: REPO_ROOT,
    execDir: __dirname,
    env: process.env,
  });
}

function licenseFilePath() {
  return join(app.getPath('userData'), 'license.json');
}

function currentMachineId() {
  return licenseLocal.machineFingerprint({
    hostname: hostname(),
    username: userInfo().username,
    platform: process.platform,
    arch: process.arch,
  });
}

function licensePublicPem() {
  const layout = stackLayout();
  return (
    process.env.MASTYF_AI_LICENSE_PUBLIC_KEY ||
    licenseLocal.readPublicKey(layout.licensePublicKey) ||
    licenseLocal.readPublicKey(join(__dirname, 'dev-license-public.pem'))
  );
}

function packagedRequiresLicense() {
  if (!app.isPackaged) return process.env.MASTYF_AI_REQUIRE_LICENSE === 'true';
  if (process.env.MASTYF_SHIELD_DEV_LICENSE === '1') return false;
  return true;
}

function readStoredLicense() {
  return licenseLocal.loadLicenseRecord(licenseFilePath());
}

function evaluateStoredLicense() {
  const rec = readStoredLicense();
  if (!rec || !rec.token) return { ok: false, reason: 'missing' };
  const mid = currentMachineId();
  if (rec.mid && rec.mid !== mid) {
    return { ok: false, reason: 'machine-mismatch', detail: 'This license is bound to another machine.' };
  }
  if (rec.kind === 'lemon' || licenseLocal.looksLikeLemonKey(rec.token)) {
    return {
      ok: true,
      record: rec,
      verified: { ok: true, kind: 'lemon', payload: { email: rec.email || '' } },
      machineId: mid,
    };
  }
  const verified = licenseLocal.verifyLicenseToken(rec.token, licensePublicPem(), Date.now(), rec.mid || '');
  if (!verified.ok) {
    return {
      ok: false,
      reason: verified.reason,
      detail: `License ${verified.reason || 'rejected'}.`,
    };
  }
  return { ok: true, record: rec, verified, machineId: mid };
}

const AUTOSTART = resolveAutostart({ packaged: app.isPackaged, env: process.env });

function applianceHomes() {
  const homes = resolveApplianceHomes({
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
    homedir: homedir(),
    env: process.env,
  });
  mkdirSync(homes.mastyfHome, { recursive: true });
  mkdirSync(homes.mastyfAiHome, { recursive: true });
  mkdirSync(homes.logDir, { recursive: true });
  return homes;
}

function childStackEnv() {
  const homes = applianceHomes();
  const layout = stackLayout();
  const license = evaluateStoredLicense();
  const env = {
    MASTYF_HOME: homes.mastyfHome,
    MASTYF_AI_HOME: homes.mastyfAiHome,
    MASTYF_AI_DB_PATH: homes.historyDb,
    MASTYF_SHIELD_LOG_DIR: homes.logDir,
    MASTYF_GATEWAY_PORT: String(GATEWAY_PORT),
    MASTYF_GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
    MASTYF_CONTROL_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
    MASTYF_AI_PORT: String(BFF_PORT),
    DASHBOARD_PORT: String(BFF_PORT),
    MASTYF_CONTROL_ALLOWED_ORIGINS: `http://127.0.0.1:${BFF_PORT},http://localhost:${BFF_PORT}`,
    DASHBOARD_ALLOWED_ORIGINS: `http://127.0.0.1:${BFF_PORT},http://localhost:${BFF_PORT}`,
    MASTYF_AI_DEPLOY_DIR: layout.deployRoot,
    PYTHONPATH: layout.gatewaySrc,
    MASTYF_AI_PACKAGED: app.isPackaged ? 'true' : '',
    MASTYF_AI_FLEET_MODE: process.env.MASTYF_AI_FLEET_MODE || (app.isPackaged ? 'false' : 'true'),
    MASTYF_AI_FLEET_CHILD: process.env.MASTYF_AI_FLEET_CHILD || (app.isPackaged ? 'true' : ''),
  };
  if (app.isPackaged) {
    env.MASTYF_AI_CI_BYPASS_LICENSE = '';
    env.MASTYF_AI_REQUIRE_LICENSE = packagedRequiresLicense() ? 'true' : 'false';
    env.MASTYF_AI_LICENSE_PUBLIC_KEY = layout.licensePublicKey || licensePublicPem();
    env.MASTYF_AI_LICENSE_FILE = licenseFilePath();
    env.MASTYF_AI_LICENSE_MACHINE_ID = currentMachineId();
    if (license.ok && license.record?.token) {
      env.MASTYF_AI_LICENSE_KEY = license.record.token;
      env.MASTYF_LICENSE_KEY = license.record.token;
      if (String(license.record.token).startsWith('MSH1.')) {
        env.MASTYF_AI_OFFLINE_LICENSE_KEY = license.record.token;
      }
    }
  }
  return env;
}

function writePackagedMcpConfig(layout, nodeBin) {
  const homes = applianceHomes();
  const sandbox = join(homes.mastyfHome, 'sandbox');
  mkdirSync(sandbox, { recursive: true });
  const fsServer = join(
    layout.bffRoot,
    'node_modules',
    '@modelcontextprotocol',
    'server-filesystem',
    'dist',
    'index.js',
  );
  const cfg = {
    mcpServers: {
      filesystem: existsSync(fsServer)
        ? { command: nodeBin, args: [fsServer, sandbox], transport: 'stdio' }
        : {
            command: nodeBin,
            args: [layout.mcpConfig],
            transport: 'stdio',
          },
    },
  };
  if (!existsSync(fsServer)) {
    cfg.mcpServers.filesystem = {
      command: nodeBin,
      args: [
        '-e',
        'console.error("Packaged filesystem MCP missing. Rebuild with stage-shield-bundle.sh"); process.exit(1)',
      ],
    };
  }
  const out = join(homes.mastyfAiHome, 'packaged-filesystem.json');
  writeFileSync(out, JSON.stringify(cfg, null, 2));
  return out;
}

/** @type {import('node:child_process').ChildProcess | null} */
let gatewayChild = null;
/** @type {import('node:child_process').ChildProcess | null} */
let bffChild = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

function ensureLogDir() {
  mkdirSync(applianceHomes().logDir, { recursive: true });
}

function deploymentDir() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'deployment');
  }
  return join(REPO_ROOT, 'deployment');
}

function userGuardDir() {
  return join(app.getPath('userData'), 'guard');
}

function readGuardManifest() {
  const p = join(deploymentDir(), 'v6-deployment-manifest.json');
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function expectedGgufMeta() {
  const m = readGuardManifest();
  const art = m?.artifact_identity || {};
  return {
    name: art.artifact_name || 'mastyf-guard-v6-q4_k_m.gguf',
    sha256: art.sha256 || null,
    size_bytes: art.size_bytes || null,
  };
}

/** Candidate GGUF paths (first existing wins). */
function resolveGgufPath() {
  const meta = expectedGgufMeta();
  const name = meta.name;
  const candidates = [
    join(deploymentDir(), name),
    join(userGuardDir(), name),
    join(REPO_ROOT, 'deployment', name),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function resolveModelfilePath() {
  const packaged = join(deploymentDir(), 'Modelfile');
  if (existsSync(packaged)) return packaged;
  const dev = join(REPO_ROOT, 'deployment', 'Modelfile');
  return existsSync(dev) ? dev : null;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function verifyGguf(filePath) {
  const meta = expectedGgufMeta();
  if (!existsSync(filePath)) return { ok: false, reason: 'missing' };
  const st = statSync(filePath);
  if (meta.size_bytes && st.size !== meta.size_bytes) {
    return { ok: false, reason: 'size-mismatch', size: st.size, expected: meta.size_bytes };
  }
  if (meta.sha256) {
    const got = await sha256File(filePath);
    if (got !== meta.sha256) {
      return { ok: false, reason: 'sha256-mismatch', got, expected: meta.sha256 };
    }
  }
  return { ok: true, path: filePath };
}

/**
 * Ensure GGUF is present for Ollama create.
 * Order: existing path → copy from repo → download MASTYF_GUARD_GGUF_URL → fail honest.
 */
async function ensureGuardGguf() {
  const existing = resolveGgufPath();
  if (existing) {
    const v = await verifyGguf(existing);
    if (v.ok) return { ok: true, path: existing, source: 'local' };
  }

  if (guardDownloadAttempted) {
    return { ok: false, reason: 'already-tried-download' };
  }
  guardDownloadAttempted = true;

  const url = process.env.MASTYF_GUARD_GGUF_URL || '';
  if (!url) {
    return {
      ok: false,
      reason: 'gguf-missing',
      hint: 'Place GGUF under deployment/ or userData/guard/, or set MASTYF_GUARD_GGUF_URL',
      meta: expectedGgufMeta(),
    };
  }

  ensureLogDir();
  const destDir = userGuardDir();
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, expectedGgufMeta().name);
  const partial = `${dest}.partial`;
  const logPath = join(applianceHomes().logDir, 'gguf-download.log');
  const out = createWriteStream(logPath, { flags: 'a' });
  out.write(`\n[${new Date().toISOString()}] download ${url} → ${dest}\n`);

  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      out.write(`HTTP ${res.status}\n`);
      out.end();
      return { ok: false, reason: `download-http-${res.status}`, logPath };
    }
    const { Readable } = require('node:stream');
    const nodeStream = Readable.fromWeb(res.body);
    await pipeline(nodeStream, createWriteStream(partial));
    const v = await verifyGguf(partial);
    if (!v.ok) {
      out.write(`verify failed: ${JSON.stringify(v)}\n`);
      out.end();
      return { ok: false, reason: v.reason, logPath, detail: v };
    }
    renameSync(partial, dest);
    out.write(`OK sha verified\n`);
    out.end();
    return { ok: true, path: dest, source: 'download', logPath };
  } catch (err) {
    out.write(`${err instanceof Error ? err.message : String(err)}\n`);
    out.end();
    return { ok: false, reason: 'download-error', error: String(err), logPath };
  }
}

/**
 * Write a Modelfile that FROM-points at an absolute GGUF path (packaged layouts).
 */
function materializeModelfile(ggufPath) {
  const templatePath = resolveModelfilePath();
  if (!templatePath) return null;
  const destDir = userGuardDir();
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, 'Modelfile');
  let body = readFileSync(templatePath, 'utf8');
  body = body.replace(/^FROM\s+.+$/m, `FROM ${ggufPath}`);
  writeFileSync(dest, body, 'utf8');
  return dest;
}

function localDashboardAuthHeaders() {
  const keyPath = join(applianceHomes().mastyfHome, 'dashboard_api_key');
  if (!existsSync(keyPath)) return {};
  const key = readFileSync(keyPath, 'utf8').trim();
  if (key.length < 16) return {};
  return { Authorization: `Bearer ${key}`, 'X-API-Key': key };
}

function installLocalDashboardAuth() {
  const urls = [`http://127.0.0.1:${BFF_PORT}/*`, `http://localhost:${BFF_PORT}/*`];
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls }, (details, cb) => {
    cb({ requestHeaders: { ...details.requestHeaders, ...localDashboardAuthHeaders() } });
  });
}

async function probe(url, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const needsAuth = /:(14000|4000)\b/.test(String(url)) || String(url).includes(`:${BFF_PORT}`);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: needsAuth ? localDashboardAuthHeaders() : undefined,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}

async function ollamaHasModel(modelName) {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (!res.ok) return false;
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    const needle = String(modelName || '').toLowerCase();
    return models.some((m) => {
      const name = String(m?.name || m?.model || '').toLowerCase();
      return name === needle || name.startsWith(`${needle}:`);
    });
  } catch {
    return false;
  }
}

/**
 * First-run: if Ollama is up but mastyf-guard-v6 is missing, create it from
 * Modelfile + GGUF (bundled, userData, or downloaded). Never invent success.
 */
async function ensureGuardOllamaModel() {
  if (guardCreateAttempted) return { attempted: false, reason: 'already-tried' };
  guardCreateAttempted = true;

  const ollamaUp = await probe('http://127.0.0.1:11434/api/tags');
  if (!ollamaUp.ok) {
    return { attempted: false, reason: 'ollama-unreachable' };
  }
  if (await ollamaHasModel(GUARD_MODEL)) {
    return { attempted: false, reason: 'model-present', model: GUARD_MODEL };
  }

  const gguf = await ensureGuardGguf();
  if (!gguf.ok) {
    return { attempted: false, reason: gguf.reason || 'gguf-missing', detail: gguf };
  }

  const modelfile = materializeModelfile(gguf.path) || resolveModelfilePath();
  if (!modelfile) {
    return { attempted: false, reason: 'modelfile-missing' };
  }

  ensureLogDir();
  const logPath = join(applianceHomes().logDir, 'ollama-create-guard.log');
  const out = createWriteStream(logPath, { flags: 'a' });
  out.write(`\n[${new Date().toISOString()}] ollama create ${GUARD_MODEL} -f ${modelfile}\n`);

  return await new Promise((resolvePromise) => {
    const child = spawn('ollama', ['create', GUARD_MODEL, '-f', modelfile], {
      cwd: join(modelfile, '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.stdout) child.stdout.pipe(out);
    if (child.stderr) child.stderr.pipe(out);
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      out.write(`\n[${new Date().toISOString()}] timed out creating ${GUARD_MODEL}\n`);
      resolvePromise({ attempted: true, ok: false, reason: 'create-timeout', logPath });
    }, 10 * 60 * 1000);
    child.on('exit', async (code) => {
      clearTimeout(timer);
      out.write(`\n[${new Date().toISOString()}] exit code=${code}\n`);
      const present = await ollamaHasModel(GUARD_MODEL);
      resolvePromise({
        attempted: true,
        ok: code === 0 && present,
        reason: present ? 'created' : `create-exit-${code}`,
        model: GUARD_MODEL,
        logPath,
      });
    });
  });
}

async function collectStatus() {
  try {
    const rh = await fetch(`http://127.0.0.1:${BFF_PORT}/api/gateway/runtime-health`, {
      headers: localDashboardAuthHeaders(),
    });
    if (rh.ok) {
      const data = await rh.json();
      const [ui, ollama] = await Promise.all([
        probe(UI_URL),
        probe('http://127.0.0.1:11434/api/tags'),
      ]);
      const guard = {
        engine: data?.guard?.engine || 'unavailable',
        model: data?.guard?.model || null,
        backend: data?.guard?.backend || null,
        fallback_active: Boolean(data?.guard?.fallback_active),
        fallback_reason: data?.guard?.fallback_reason || null,
        advisory: true,
        cannot_expand_authority: true,
        status_available: Boolean(data?.gateway?.status_available),
      };
      return {
        gateway: {
          port: GATEWAY_PORT,
          ok: Boolean(data?.gateway?.ok),
          detail: data?.gateway?.detail || null,
          managed: Boolean(gatewayChild),
        },
        bff: {
          port: BFF_PORT,
          ok: Boolean(data?.bff?.ok),
          managed: Boolean(bffChild),
        },
        ui: { url: UI_URL, ...ui },
        ollama: { ...ollama },
        guard,
        stack_honest: Boolean(data?.stack_honest),
        degrade: data?.degrade || null,
        source: data?.source || 'bff-runtime-health',
        repoRoot: app.isPackaged ? stackLayout().stackRoot : REPO_ROOT,
        logDir: applianceHomes().logDir,
        packaged: app.isPackaged,
        mastyfHome: applianceHomes().mastyfHome,
        isolatedLedger: applianceHomes().isolated,
        note: 'Electron does not evaluate policy or AIA; Gateway is the reference monitor.',
      };
    }
  } catch {
    /* fall through */
  }

  const [gateway, bff, ui, ollama] = await Promise.all([
    probe(`http://127.0.0.1:${GATEWAY_PORT}/healthz`).catch(() =>
      probe(`http://127.0.0.1:${GATEWAY_PORT}/readyz`),
    ),
    probe(`http://127.0.0.1:${BFF_PORT}/api/gateway/status`),
    probe(UI_URL),
    probe('http://127.0.0.1:11434/api/tags'),
  ]);

  let guard = {
    engine: 'unavailable',
    model: null,
    advisory: true,
    cannot_expand_authority: true,
    fallback_active: false,
    fallback_reason: null,
    backend: null,
    status_available: false,
  };
  try {
    const res = await fetch(`http://127.0.0.1:${BFF_PORT}/api/gateway/status`, {
      headers: localDashboardAuthHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      const intel = data.intelligence || {};
      guard = {
        engine: intel.aia_engine || 'unavailable',
        model: intel.aia_model || intel.name || null,
        backend: intel.aia_backend || null,
        fallback_active: Boolean(intel.fallback_active),
        fallback_reason: intel.fallback_reason || null,
        advisory: true,
        cannot_expand_authority: true,
        status_available: data.available === true,
      };
    }
  } catch {
    /* optional */
  }

  return {
    gateway: { port: GATEWAY_PORT, ...gateway, managed: Boolean(gatewayChild) },
    bff: { port: BFF_PORT, ...bff, managed: Boolean(bffChild) },
    ui: { url: UI_URL, ...ui },
    ollama: { ...ollama },
    guard,
        repoRoot: app.isPackaged ? stackLayout().stackRoot : REPO_ROOT,
    logDir: applianceHomes().logDir,
    packaged: app.isPackaged,
    mastyfHome: applianceHomes().mastyfHome,
    isolatedLedger: applianceHomes().isolated,
    note: 'Electron does not evaluate policy or AIA; Gateway is the reference monitor.',
  };
}

function spawnLogged(name, command, args, cwd, env = {}) {
  ensureLogDir();
  const logPath = join(applianceHomes().logDir, `${name}.log`);
  const out = createWriteStream(logPath, { flags: 'a' });
  const merged = { ...process.env, ...env };
  if (env.ELECTRON_RUN_AS_NODE === '') {
    delete merged.ELECTRON_RUN_AS_NODE;
  }
  const child = spawn(command, args, {
    cwd,
    env: merged,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  if (child.stdout) child.stdout.pipe(out);
  if (child.stderr) child.stderr.pipe(out);
  child.on('exit', (code) => {
    out.write(`\n[${new Date().toISOString()}] ${name} exited code=${code}\n`);
  });
  return child;
}

function wireCrashRecovery(name, child, restartFn, getBackoff, setBackoff) {
  if (!child) return;
  child.on('exit', (code) => {
    if (quitting || !AUTOSTART) return;
    const wait = getBackoff();
    ensureLogDir();
    const logPath = join(applianceHomes().logDir, 'crash-recovery.log');
    const line = `[${new Date().toISOString()}] ${name} exit=${code}; restart in ${wait}ms\n`;
    createWriteStream(logPath, { flags: 'a' }).end(line);
    setTimeout(() => {
      if (quitting) return;
      restartFn();
      setBackoff(Math.min(getBackoff() * 2, 30000));
    }, wait);
  });
}

function startGateway() {
  if (gatewayChild && !gatewayChild.killed) return gatewayChild;
  const layout = stackLayout();
  const py = layout.python;
  gatewayChild = spawnLogged(
    'gateway',
    py,
    ['-m', 'mastyf_gateway.cli', 'serve', '--host', '127.0.0.1', '--port', String(GATEWAY_PORT)],
    layout.gatewaySrc,
    {
      ...childStackEnv(),
      MASTYF_AIA_BACKEND: process.env.MASTYF_AIA_BACKEND || 'openai_compat',
      MASTYF_AIA_OLLAMA_MODEL: process.env.MASTYF_AIA_OLLAMA_MODEL || 'mastyf-guard-v6',
    },
  );
  wireCrashRecovery(
    'gateway',
    gatewayChild,
    () => {
      gatewayChild = null;
      startGateway();
    },
    () => gatewayRestartBackoffMs,
    (v) => {
      gatewayRestartBackoffMs = v;
    },
  );
  return gatewayChild;
}

function startBff() {
  if (bffChild && !bffChild.killed) return bffChild;
  const layout = stackLayout();
  const env = {
    ...childStackEnv(),
    DASHBOARD_ENABLED: 'true',
    DASHBOARD_BIND: '127.0.0.1',
    MASTYF_AI_WS_ENABLED: process.env.MASTYF_AI_WS_ENABLED || 'true',
  };
  if (app.isPackaged && layout.hasBffCli) {
    const nodeBin = layout.nodeBin || process.execPath;
    const runAsElectronNode = !layout.nodeBin;
    const mcpConfig = writePackagedMcpConfig(layout, nodeBin);
    bffChild = spawnLogged(
      'bff',
      nodeBin,
      [
        layout.bffCli,
        'proxy',
        '--config',
        mcpConfig,
        '--policy',
        layout.policy,
        '--blocking-mode',
        process.env.MASTYF_AI_BLOCKING_MODE || 'block',
      ],
      layout.bffRoot,
      {
        ...env,
        ...(runAsElectronNode ? { ELECTRON_RUN_AS_NODE: '1' } : { ELECTRON_RUN_AS_NODE: '' }),
        NODE_PATH: join(layout.bffRoot, 'node_modules'),
      },
    );
  } else {
    const script = join(REPO_ROOT, 'scripts', 'start-dashboard-proxy.sh');
    bffChild = spawnLogged('bff', 'bash', [script, layout.mcpConfig, layout.policy], REPO_ROOT, env);
  }
  wireCrashRecovery(
    'bff',
    bffChild,
    () => {
      bffChild = null;
      startBff();
    },
    () => bffRestartBackoffMs,
    (v) => {
      bffRestartBackoffMs = v;
    },
  );
  return bffChild;
}

function stopChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

async function waitForHealthy(label, fn, attempts = 40, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    const st = await fn();
    if (st.ok) {
      if (label === 'gateway') gatewayRestartBackoffMs = 1000;
      if (label === 'bff') bffRestartBackoffMs = 1000;
      return true;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

function isStackHonest(status) {
  if (typeof status?.stack_honest === 'boolean') return status.stack_honest;
  const gatewayOk = Boolean(status?.gateway?.ok);
  const bffOk = Boolean(status?.bff?.ok);
  const available = Boolean(status?.guard?.status_available);
  const engine = String(status?.guard?.engine || 'unavailable');
  const guardHonest =
    available &&
    (engine !== 'unavailable' || Boolean(status?.guard?.fallback_active));
  return gatewayOk && bffOk && guardHonest;
}

function healthGateHtml(status, message) {
  const g = status?.gateway?.ok ? 'OK' : 'WAIT';
  const b = status?.bff?.ok ? 'OK' : 'WAIT';
  const eng = status?.guard?.engine || 'unavailable';
  const model = status?.guard?.model || '—';
  const fb = status?.guard?.fallback_active
    ? `fallback: ${status?.guard?.fallback_reason || 'active'}`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Mastyf Shield — Health Gate</title>
<style>
  body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0b0f14;color:#e8eef7;padding:2.5rem;line-height:1.5}
  h1{font-size:1.25rem;margin:0 0 0.75rem;letter-spacing:0.04em}
  .row{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}
  .pill{border:1px solid #2a3544;padding:0.35rem 0.65rem;border-radius:2px;font-size:0.75rem}
  .ok{border-color:#1f6f4a;color:#3dffa8}.wait{border-color:#5a4a1a;color:#ffc14d}.bad{border-color:#6f1f2f;color:#ff5c7a}
  p{color:#8b95a8;font-size:0.85rem;max-width:42rem}
  code{color:#d7dee8}
</style></head><body>
  <h1>MASTYF SHIELD · COLD START</h1>
  <p>${message || 'Waiting for Gateway, BFF, and an honest Guard engine report before loading the appliance.'}</p>
  <div class="row">
    <span class="pill ${status?.gateway?.ok ? 'ok' : 'wait'}">:${GATEWAY_PORT} Gateway ${g}</span>
    <span class="pill ${status?.bff?.ok ? 'ok' : 'wait'}">:${BFF_PORT} BFF ${b}</span>
    <span class="pill ${eng !== 'unavailable' || status?.guard?.fallback_active ? 'ok' : 'wait'}">Guard ${eng}${model && model !== '—' ? ' · ' + model : ''}</span>
  </div>
  ${fb ? `<p>${fb}</p>` : ''}
  ${
    status?.ollama?.ok
      ? ''
      : '<p class="bad">Ollama is not running. Guard V6 stays advisory and is not marked online. Install from https://ollama.com/download , then Runtime → Ensure Guard Model.</p>'
  }
  <p>Electron never evaluates CBAC/DIFC/Workflow/AIA. Packaged builds spawn an isolated Gateway/BFF into this app’s userData home.</p>
  <p>Use menu <strong>Runtime → Retry Health Gate</strong> after fixing the stack. Polling…</p>
</body></html>`;
}

async function waitForHonestStack(win, { attempts = 90, delayMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const status = await collectStatus();
    if (isStackHonest(status)) return status;
    if (AUTOSTART) {
      if (!status.gateway?.ok) startGateway();
      if (!status.bff?.ok) startBff();
    }
    if (win && !win.isDestroyed()) {
      const msg =
        i === 0
          ? `Blocking appliance until :${GATEWAY_PORT}, :${BFF_PORT}, and Guard report honestly.`
          : `Still waiting (${i + 1}/${attempts})…`;
      await win.loadURL(`data:text/html,${encodeURIComponent(healthGateHtml(status, msg))}`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return collectStatus();
}

async function loadApplianceOrGate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const skipGate = process.env.MASTYF_SHIELD_SKIP_HEALTH_GATE === '1';
  let status = await collectStatus();
  if (!skipGate) {
    await mainWindow.loadURL(
      `data:text/html,${encodeURIComponent(
        healthGateHtml(status, `Blocking appliance until :${GATEWAY_PORT}, :${BFF_PORT}, and Guard report honestly.`),
      )}`,
    );
    status = await waitForHonestStack(mainWindow);
  }
  if (!skipGate && !isStackHonest(status)) {
    await mainWindow.loadURL(
      `data:text/html,${encodeURIComponent(
        healthGateHtml(
          status,
          `Health gate timed out. Start Gateway :${GATEWAY_PORT} + BFF :${BFF_PORT} + Guard (Ollama ${GUARD_MODEL}), then use Runtime → Retry Health Gate. UI stays blocked — empty is better than a dishonest shell.`,
        ),
      )}`,
    );
    return { ok: false, status };
  }
  try {
    await mainWindow.loadURL(resolveStartupUrl());
    return { ok: true, status };
  } catch (err) {
    const html = `<!doctype html><html><body style="font-family:system-ui;background:#0b0f14;color:#e8eef7;padding:2rem">
      <h1>Mastyf Shield</h1>
      <p>Could not load appliance UI at <code>${UI_URL}</code>.</p>
      <p>${String(err)}</p>
      <p>Start <code>pnpm dashboard:dev</code> (or set MASTYF_SHIELD_UI_URL), plus Gateway :${GATEWAY_PORT} and BFF :${BFF_PORT}.</p>
      <p>Security decisions are never made in this Electron process.</p>
    </body></html>`;
    await mainWindow.loadURL(`data:text/html,${encodeURIComponent(html)}`);
    return { ok: false, status, error: String(err) };
  }
}

async function ensureRuntime() {
  const status = await collectStatus();
  if (!AUTOSTART) {
    await ensureGuardOllamaModel();
    return collectStatus();
  }

  if (!status.gateway.ok) startGateway();
  if (!status.bff.ok) startBff();

  await waitForHealthy('gateway', () =>
    probe(`http://127.0.0.1:${GATEWAY_PORT}/healthz`).catch(() =>
      probe(`http://127.0.0.1:${GATEWAY_PORT}/readyz`),
    ),
  );
  await waitForHealthy('bff', () => probe(`http://127.0.0.1:${BFF_PORT}/api/gateway/status`));
  await ensureGuardOllamaModel();
  return collectStatus();
}

function startHealthMonitor() {
  if (healthMonitorTimer) return;
  healthMonitorTimer = setInterval(async () => {
    if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
    const status = await collectStatus();
    if (isStackHonest(status)) {
      gatewayRestartBackoffMs = 1000;
      bffRestartBackoffMs = 1000;
      return;
    }
    // Crash recovery while appliance was LIVE: re-enter gate instead of silent empty UI.
    if (AUTOSTART) {
      if (!status.gateway?.ok) startGateway();
      if (!status.bff?.ok) startBff();
    }
    const url = mainWindow.webContents.getURL();
    if (url.startsWith('http') && !url.startsWith('data:')) {
      await mainWindow.loadURL(
        `data:text/html,${encodeURIComponent(
          healthGateHtml(
            status,
            'Stack became dishonest after LIVE — re-entering health gate. Autostart will respawn managed children if enabled.',
          ),
        )}`,
      );
      void waitForHonestStack(mainWindow, { attempts: 45, delayMs: 1000 }).then(async (st) => {
        if (isStackHonest(st) && mainWindow && !mainWindow.isDestroyed()) {
          await mainWindow.loadURL(resolveStartupUrl());
        }
      });
    }
  }, 15000);
}

async function openDeepLinkTarget(target) {
  const links = deepLinks();
  const key = String(target || 'shield').toLowerCase();
  const url =
    key === 'ask'
      ? links.ask
      : key === 'access' || key === 'security' || key === 'security-center' || key === 'ai-access'
        ? links.access
        : links.shield;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const status = await collectStatus();
    if (!isStackHonest(status) && process.env.MASTYF_SHIELD_SKIP_HEALTH_GATE !== '1') {
      await loadApplianceOrGate();
      return { ok: false, reason: 'gate-blocked', url };
    }
    await mainWindow.loadURL(url);
  }
  return { ok: true, url };
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Shield',
          accelerator: 'CmdOrCtrl+1',
          click: () => void openDeepLinkTarget('shield'),
        },
        {
          label: 'AI Access',
          accelerator: 'CmdOrCtrl+2',
          click: () => void openDeepLinkTarget('access'),
        },
        {
          label: 'Ask Mastyf',
          accelerator: 'CmdOrCtrl+3',
          click: () => void openDeepLinkTarget('ask'),
        },
      ],
    },
    {
      label: 'Runtime',
      submenu: [
        {
          label: 'Open Logs',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: async () => {
            ensureLogDir();
            await shell.openPath(applianceHomes().logDir);
          },
        },
        {
          label: 'Restart Gateway',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: async () => {
            stopChild(gatewayChild);
            gatewayChild = null;
            startGateway();
            await waitForHealthy('gateway', () =>
              probe(`http://127.0.0.1:${GATEWAY_PORT}/healthz`).catch(() =>
                probe(`http://127.0.0.1:${GATEWAY_PORT}/readyz`),
              ),
            );
          },
        },
        {
          label: 'Restart BFF',
          click: async () => {
            stopChild(bffChild);
            bffChild = null;
            startBff();
            await waitForHealthy('bff', () =>
              probe(`http://127.0.0.1:${BFF_PORT}/api/gateway/status`),
            );
          },
        },
        {
          label: 'Retry Health Gate',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => void loadApplianceOrGate(),
        },
        { type: 'separator' },
        {
          label: 'Ensure Guard Model (Ollama)',
          click: async () => {
            guardCreateAttempted = false;
            guardDownloadAttempted = false;
            const result = await ensureGuardOllamaModel();
            dialog.showMessageBox({
              type: result.ok || result.reason === 'model-present' ? 'info' : 'warning',
              title: 'Guard V6',
              message: 'Guard model ensure',
              detail: JSON.stringify(result, null, 2),
            });
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }, ...(isMac ? [{ role: 'front' }] : [])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function activateLicenseKey(token) {
  const raw = String(token || '').trim();
  const mid = currentMachineId();
  if (licenseLocal.looksLikeLemonKey(raw)) {
    licenseLocal.saveLicenseRecord(licenseFilePath(), {
      kind: 'lemon',
      token: raw,
      mid,
      activatedAt: new Date().toISOString(),
    });
    return { ok: true, kind: 'lemon' };
  }
  const verified = licenseLocal.verifyLicenseToken(raw, licensePublicPem(), Date.now(), '');
  if (!verified.ok) {
    return {
      ok: false,
      reason: verified.reason,
      detail:
        verified.reason === 'expired'
          ? 'This license is past its offline grace window.'
          : verified.reason === 'signature'
            ? 'Signature does not match this build’s public key.'
            : `License rejected (${verified.reason || 'invalid'}). Paste an MSH1 key or your Lemon Squeezy license.`,
    };
  }
  licenseLocal.saveLicenseRecord(licenseFilePath(), {
    kind: 'msh1',
    token: raw,
    mid,
    email: verified.payload?.email || verified.payload?.sub || '',
    activatedAt: new Date().toISOString(),
    expiresAt: verified.expiresAt,
  });
  return { ok: true, kind: 'msh1', expiresAt: verified.expiresAt, grace: verified.grace };
}

async function loadLicenseGate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const store = process.env.MASTYF_SHIELD_STORE_URL || 'https://mastyfai.lemonsqueezy.com/';
  const gate = join(__dirname, 'license-gate.html');
  if (existsSync(gate)) {
    await mainWindow.loadFile(gate, { query: { store } });
    return;
  }
  await mainWindow.loadURL(
    `data:text/html,${encodeURIComponent(
      `<!doctype html><html><body style="font-family:system-ui;background:#0b0f14;color:#e8eef7;padding:2rem">
      <h1>Activate Mastyf Shield</h1>
      <p>Paste your MSH1 license. Buy: ${store}</p>
      </body></html>`,
    )}`,
  );
}

async function probeForeignLaptopStack() {
  const [gw, bff] = await Promise.all([
    probe('http://127.0.0.1:8443/healthz').catch(() => ({ ok: false })),
    probe('http://127.0.0.1:4000/api/gateway/status').catch(() => ({ ok: false })),
  ]);
  return {
    foreignGatewayOnLaptopPorts: Boolean(gw.ok),
    foreignBffOnLaptopPorts: Boolean(bff.ok),
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'Mastyf Shield',
    backgroundColor: '#0b0f14',
    icon: existsSync(join(__dirname, 'icon.png')) ? join(__dirname, 'icon.png') : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle('shield:status', async () => collectStatus());
  ipcMain.handle('shield:guard-status', async () => {
    const st = await collectStatus();
    return st.guard;
  });
  ipcMain.handle('shield:open-logs', async () => {
    ensureLogDir();
    const logDir = applianceHomes().logDir;
    await shell.openPath(logDir);
    return { ok: true, logDir };
  });
  ipcMain.handle('shield:open-deeplink', async (_evt, target) => openDeepLinkTarget(target));
  ipcMain.handle('shield:restart-gateway', async () => {
    stopChild(gatewayChild);
    gatewayChild = null;
    startGateway();
    await waitForHealthy('gateway', () =>
      probe(`http://127.0.0.1:${GATEWAY_PORT}/healthz`).catch(() =>
        probe(`http://127.0.0.1:${GATEWAY_PORT}/readyz`),
      ),
    );
    return collectStatus();
  });
  ipcMain.handle('shield:restart-bff', async () => {
    stopChild(bffChild);
    bffChild = null;
    startBff();
    await waitForHealthy('bff', () => probe(`http://127.0.0.1:${BFF_PORT}/api/gateway/status`));
    return collectStatus();
  });
  ipcMain.handle('shield:retry-gate', async () => loadApplianceOrGate());
  ipcMain.handle('shield:license-status', async () => evaluateStoredLicense());
  ipcMain.handle('shield:activate-license', async (_evt, token) => {
    const result = await activateLicenseKey(token);
    if (result.ok) {
      void (async () => {
        await ensureRuntime();
        await loadApplianceOrGate();
        startHealthMonitor();
      })();
    }
    return result;
  });
  ipcMain.handle('shield:open-external', async (_evt, url) => {
    const allowed = String(url || '');
    if (!/^https:\/\//i.test(allowed)) return { ok: false, reason: 'https-only' };
    await shell.openExternal(allowed);
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  refreshRuntimeEndpoints();
  installLocalDashboardAuth();
  registerIpc();
  buildAppMenu();

  if (app.isPackaged) {
    const bundled = evaluatePackagedStack(stackLayout());
    if (!bundled.ok) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Mastyf Shield',
        message: 'This installer is incomplete',
        detail: bundled.detail || bundled.reason,
      });
      app.quit();
      return;
    }
    const foreign = evaluateForeignStack({
      packaged: true,
      env: process.env,
      gatewayPort: GATEWAY_PORT,
      bffPort: BFF_PORT,
      ...(await probeForeignLaptopStack()),
    });
    if (!foreign.ok) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Mastyf Shield',
        message: 'Foreign stack on this Mac',
        detail: foreign.detail || foreign.reason,
      });
      app.quit();
      return;
    }
  }

  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  if (packagedRequiresLicense() && !evaluateStoredLicense().ok) {
    await loadLicenseGate();
    return;
  }

  const status = await ensureRuntime();
  if (!status.bff.ok && !AUTOSTART) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Mastyf Shield',
      message: 'Gateway/BFF not detected',
      detail: `Expected BFF on :${BFF_PORT} and Gateway on :${GATEWAY_PORT}. Packaged builds must include extraResources/stack. Dev: start the repo stack or set MASTYF_SHIELD_AUTOSTART=1.`,
    });
  }
  await loadApplianceOrGate();
  startHealthMonitor();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (healthMonitorTimer) {
    clearInterval(healthMonitorTimer);
    healthMonitorTimer = null;
  }
  stopChild(gatewayChild);
  stopChild(bffChild);
  gatewayChild = null;
  bffChild = null;
});
