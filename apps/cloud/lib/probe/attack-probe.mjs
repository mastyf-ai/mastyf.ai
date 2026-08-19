/**
 * Live attack probe — downloads the npm tarball and scans the published source
 * for malicious or dangerous patterns WITHOUT executing any code.
 *
 * Detection categories:
 *   secret-leak      hardcoded credentials (AWS, GitHub, OpenAI, Slack, Stripe,
 *                    Google, private keys, JWTs, generic high-entropy secrets)
 *   dangerous-exec   eval / new Function / base64-decoded execution /
 *                    child_process combined with network access /
 *                    process.env combined with outbound network (exfiltration)
 *   suspicious-egress Discord webhooks, paste sites, tunnel domains, raw public IPs
 *   install-script   pre/postinstall hooks that fetch or execute remote code
 *   obfuscation      hex-encoded blobs, string-array obfuscation
 *
 * Result contract:
 *   status 'ok'     probe ran and scanned the tarball (findings may be empty)
 *   status 'unable' probe could not run (fetch/extract failure, empty package,
 *                   timeout) — scoring penalises this case
 *
 * Pure Node builtins only (fetch, zlib, fs, os, path) — no dependencies.
 */

import { createGunzip } from 'node:zlib';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';

const REGISTRY_BASE = 'https://registry.npmjs.org';
const TIMEOUT_MS = 20000;
const MAX_TARBALL_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_FILES = 400;
const MAX_FILE_BYTES = 768 * 1024; // 768 KB per file
const MAX_FINDINGS = 25;

const SCANNABLE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.json', '.env', '.yml', '.yaml', '.sh', '.bash', '.py', '.rb', '.php',
]);

// ── Detection patterns ──────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  { id: 'aws-access-key', severity: 'critical', title: 'Hardcoded AWS access key ID', re: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { id: 'aws-secret-key', severity: 'critical', title: 'Hardcoded AWS secret access key', re: /aws.{0,25}?(?:secret|private).{0,25}?['"][A-Za-z0-9/+=]{40}['"]/gi },
  { id: 'github-token', severity: 'critical', title: 'Hardcoded GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { id: 'openai-key', severity: 'critical', title: 'Hardcoded OpenAI API key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, exclude: /\bsk-(?:live|test)_/ },
  { id: 'stripe-live-key', severity: 'critical', title: 'Hardcoded Stripe live key', re: /\b(?:sk|rk|pi)_live_[A-Za-z0-9]{10,}\b/g },
  { id: 'stripe-test-key', severity: 'medium', title: 'Hardcoded Stripe test key', re: /\b(?:sk|rk)_test_[A-Za-z0-9]{10,}\b/g },
  { id: 'slack-token', severity: 'critical', title: 'Hardcoded Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'google-api-key', severity: 'high', title: 'Hardcoded Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'private-key-block', severity: 'critical', title: 'Private key material in source', re: /-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED) )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'hardcoded-jwt', severity: 'high', title: 'Hardcoded JWT bearer token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: 'generic-secret', severity: 'high', title: 'Hardcoded credential assignment', re: /(?:api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret)\s*[:=]\s*['"][A-Za-z0-9+/=_.-]{20,}['"]/gi },
];

// Values that look like documentation placeholders, not real secrets.
const PLACEHOLDER_RE = /(?:<[^>]+>|\$\{[^}]+\}|process\.env|xxx+|your[_-]?|example|placeholder|changeme|change_me|dummy|sample|redacted|todo|fixme|test[_-]?key|fake|invalid)/i;

const EGRESS_PATTERNS = [
  { id: 'discord-webhook', severity: 'medium', title: 'Discord webhook URL in source', re: /discord(?:app)?\.com\/api\/webhooks\/[\w-]+\/[\w-]+/g },
  { id: 'paste-site', severity: 'medium', title: 'Paste-site exfiltration endpoint', re: /\b(?:pastebin\.com|paste\.ee|hastebin\.com|dpaste\.org)\b/g },
  { id: 'tunnel-domain', severity: 'medium', title: 'Tunneling service endpoint (ngrok etc.)', re: /\b(?:ngrok\.io|ngrok-free\.app|ngrok\.app|serveo\.net|localtunnel\.me|localhost\.run|trycloudflare\.com)\b/g },
  { id: 'webhook-catcher', severity: 'medium', title: 'Request-capture endpoint', re: /\b(?:webhook\.site|requestbin|pipedream\.net|interact\.sh|oastify\.com|burpcollaborator\.net)\b/g },
];

// Public IP URL that is not a private/loopback range.
const RAW_IP_RE = /https?:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/g;

const EXEC_PATTERNS = [
  { id: 'dynamic-eval', severity: 'high', title: 'Dynamic eval() usage', re: /\beval\s*\(\s*(?![)'"])[^)]{0,80}\)/g },
  { id: 'dynamic-function', severity: 'high', title: 'Dynamic new Function() constructor', re: /new\s+Function\s*\(/g },
];

const NETWORK_RE = /\b(?:fetch\s*\(|https?\.request|https?\.get|axios|XMLHttpRequest|\.post\s*\(|net\.connect|tls\.connect|WebSocket\s*\()/;
const CHILD_PROCESS_RE = /\b(?:require\s*\(\s*['"]child_process['"]\s*\)|from\s+['"]child_process['"]|child_process)\b|\b(?:exec|execSync|spawn|spawnSync|execFile)\s*\(/;
const ENV_RE = /process\.env\b/;
const BASE64_DECODE_RE = /(?:Buffer\.from\s*\([^)]{0,80}['"]base64['"]\s*\)|atob\s*\()/;

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare'];
const INSTALL_NETWORK_RE = /\b(?:curl|wget|Invoke-WebRequest|iwr|fetch|https?:\/\/|node\s+|npx\s+)\b/;

// ── Tarball helpers ─────────────────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadBuffer(url, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Minimal USTAR tar parser — enough for npm tarballs.
 * Handles regular files ('0'/'\0'), GNU longname ('L') and PAX extended ('x').
 * Returns [{ path, content: Buffer }].
 */
function parseTar(buffer) {
  const entries = [];
  let offset = 0;
  let pendingLongName = null;

  const readString = (start, len) => {
    const slice = buffer.subarray(start, start + len);
    const nul = slice.indexOf(0);
    return slice.subarray(0, nul === -1 ? len : nul).toString('utf8');
  };

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive

    const nameRaw = readString(offset, 100);
    const sizeOctal = readString(offset + 124, 12).trim();
    const typeFlag = String.fromCharCode(buffer[offset + 156] || 48);
    const prefix = readString(offset + 345, 155);
    const size = parseInt(sizeOctal, 8) || 0;

    offset += 512;

    if (typeFlag === 'L') {
      pendingLongName = readString(offset, size);
      offset += Math.ceil(size / 512) * 512;
      continue;
    }
    if (typeFlag === 'x' || typeFlag === 'g') {
      // PAX extended header — skip (name/size come from the base header)
      offset += Math.ceil(size / 512) * 512;
      continue;
    }

    let name = pendingLongName ?? (prefix ? `${prefix}/${nameRaw}` : nameRaw);
    pendingLongName = null;

    if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '') {
      const content = buffer.subarray(offset, offset + size);
      entries.push({ path: name, content });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

// ── Scanning ────────────────────────────────────────────────────────────────

function isScannable(path) {
  const base = path.split('/').pop() || '';
  if (/\.min\.js$/.test(base)) return false;
  if (base === '.env' || base.startsWith('.env.')) return true;
  const ext = extname(base).toLowerCase();
  if (ext === '') return base === 'Dockerfile' || base === 'Makefile';
  return SCANNABLE_EXTENSIONS.has(ext);
}

function isDocOrFixture(path) {
  return /(?:^|\/)(?:test|tests|__tests__|__mocks__|fixtures?|examples?|docs?|samples?)\//i.test(path) ||
    /\.(?:md|mdx|txt|snap)$/i.test(path);
}

function cleanEvidence(match, line) {
  const start = Math.max(0, line.indexOf(match) - 20);
  const snippet = line.slice(start, start + 120).replace(/\s+/g, ' ').trim();
  // Mask the middle of anything that looks like a real secret value
  return snippet.replace(/['"]([A-Za-z0-9+/=_.-]{16,})['"]/g, (m, val) =>
    `'${val.slice(0, 6)}…${val.slice(-4)}'`);
}

function scanContent(relPath, content, findings) {
  if (findings.length >= MAX_FINDINGS) return;
  const text = content.toString('utf8');
  const lines = text.split('\n');
  const inDoc = isDocOrFixture(relPath);

  const push = (pattern, match, line, severityOverride) => {
    if (findings.length >= MAX_FINDINGS) return;
    if (PLACEHOLDER_RE.test(match)) return;
    const severity = severityOverride ?? pattern.severity;
    findings.push({
      id: pattern.id,
      category: pattern.category,
      severity,
      title: pattern.title,
      file: relPath,
      line,
      evidence: cleanEvidence(match, lines[line - 1] ?? ''),
      plainEnglish: `${pattern.title} detected in ${relPath}:${line}.`,
    });
  };

  // Line-oriented patterns (secrets + egress) so we can report line numbers
  for (let i = 0; i < lines.length && findings.length < MAX_FINDINGS; i++) {
    const lineText = lines[i];
    if (lineText.length > 20000) continue; // minified blob — handled below

    for (const p of SECRET_PATTERNS) {
      p.re.lastIndex = 0;
      const m = p.re.exec(lineText);
      if (m) {
        if (p.exclude && p.exclude.test(m[0])) continue;
        // Secrets in docs/fixtures are downgraded to medium
        push({ ...p, category: 'secret-leak' }, m[0], i + 1, inDoc ? 'medium' : undefined);
        break; // one secret finding per line is enough
      }
    }

    for (const p of EGRESS_PATTERNS) {
      p.re.lastIndex = 0;
      const m = p.re.exec(lineText);
      if (m) {
        push({ ...p, category: 'suspicious-egress' }, m[0], i + 1, inDoc ? 'low' : undefined);
        break;
      }
    }

    RAW_IP_RE.lastIndex = 0;
    const ipm = RAW_IP_RE.exec(lineText);
    if (ipm) {
      const [a, b] = [Number(ipm[1]), Number(ipm[2])];
      const isPrivate =
        a === 127 || a === 0 || (a === 10) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 169 && b === 254);
      if (!isPrivate && !PLACEHOLDER_RE.test(ipm[0])) {
        if (findings.length < MAX_FINDINGS) {
          findings.push({
            id: 'raw-ip-egress',
            category: 'suspicious-egress',
            severity: inDoc ? 'low' : 'medium',
            title: 'Connection to raw public IP address',
            file: relPath,
            line: i + 1,
            evidence: cleanEvidence(ipm[0], lineText),
            plainEnglish: `Code connects directly to a raw IP address (${ipm[1]}.${ipm[2]}.x.x) in ${relPath}:${i + 1} — bypasses domain-based allowlists.`,
          });
        }
      }
    }
  }

  // Whole-file behavioural patterns (skip docs)
  if (!inDoc) {
    const hasNetwork = NETWORK_RE.test(text);
    const hasChildProcess = CHILD_PROCESS_RE.test(text);
    const hasEnv = ENV_RE.test(text);
    const hasBase64 = BASE64_DECODE_RE.test(text);

    if (hasChildProcess && hasNetwork) {
      findings.push({
        id: 'exec-plus-network',
        category: 'dangerous-exec',
        severity: 'high',
        title: 'Shell execution combined with network access',
        file: relPath,
        line: 0,
        evidence: 'child_process + outbound network primitives in the same module',
        plainEnglish: `${relPath} can both execute shell commands and reach the network — a common malware combination.`,
      });
    }
    if (hasEnv && hasNetwork && !hasChildProcess) {
      findings.push({
        id: 'env-plus-network',
        category: 'dangerous-exec',
        severity: 'high',
        title: 'Environment access combined with network egress',
        file: relPath,
        line: 0,
        evidence: 'process.env + outbound network primitives in the same module',
        plainEnglish: `${relPath} reads process.env and makes network calls — potential credential exfiltration path.`,
      });
    }
    if (hasBase64 && (hasChildProcess || /\beval\s*\(|new\s+Function/.test(text))) {
      findings.push({
        id: 'base64-exec',
        category: 'dangerous-exec',
        severity: 'high',
        title: 'Base64-decoded code execution',
        file: relPath,
        line: 0,
        evidence: 'base64 decode + eval/exec in the same module',
        plainEnglish: `${relPath} decodes base64 data and passes it to dynamic execution — typical obfuscated-payload pattern.`,
      });
    }

    for (const p of EXEC_PATTERNS) {
      p.re.lastIndex = 0;
      const m = p.re.exec(text);
      if (m) {
        if (findings.length < MAX_FINDINGS) {
          findings.push({
            id: p.id,
            category: 'dangerous-exec',
            severity: p.severity,
            title: p.title,
            file: relPath,
            line: text.slice(0, m.index).split('\n').length,
            evidence: cleanEvidence(m[0], m[0]),
            plainEnglish: `${p.title} in ${relPath}.`,
          });
        }
      }
    }

    // Obfuscation: dense hex escapes
    const hexEscapes = (text.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
    if (hexEscapes > 60) {
      findings.push({
        id: 'hex-obfuscation',
        category: 'obfuscation',
        severity: 'low',
        title: 'Hex-encoded obfuscated strings',
        file: relPath,
        line: 0,
        evidence: `${hexEscapes} \\xNN escape sequences`,
        plainEnglish: `${relPath} contains ${hexEscapes} hex-escaped characters — likely obfuscated code.`,
      });
    }
    // Obfuscation: large array of base64-ish strings
    const b64Strings = (text.match(/['"][A-Za-z0-9+/]{24,}={0,2}['"]/g) || []).length;
    if (b64Strings > 40) {
      findings.push({
        id: 'string-array-obfuscation',
        category: 'obfuscation',
        severity: 'low',
        title: 'Large base64 string array (possible obfuscation)',
        file: relPath,
        line: 0,
        evidence: `${b64Strings} long base64-like string literals`,
        plainEnglish: `${relPath} embeds ${b64Strings} long base64-like strings — common in obfuscated bundles.`,
      });
    }
  }
}

function scanPackageJson(relPath, content, findings) {
  let pkg;
  try {
    pkg = JSON.parse(content.toString('utf8'));
  } catch {
    return;
  }
  const scripts = pkg.scripts ?? {};
  for (const hook of INSTALL_HOOKS) {
    const script = scripts[hook];
    if (typeof script === 'string' && script.trim().length > 0) {
      const networky = INSTALL_NETWORK_RE.test(script);
      findings.push({
        id: networky ? 'install-script-network' : 'install-script',
        category: 'install-script',
        severity: networky ? 'high' : 'medium',
        title: networky
          ? `Install hook "${hook}" fetches or executes remote code`
          : `Install hook "${hook}" runs code at install time`,
        file: relPath,
        line: 0,
        evidence: `${hook}: ${script.slice(0, 120)}`,
        plainEnglish: networky
          ? `The package's ${hook} script runs network or remote code during npm install — code executes before you ever use the package.`
          : `The package's ${hook} script runs during npm install.`,
      });
    }
  }
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Probe a package's published tarball without executing it.
 * @param {string} packageName npm package name (scoped or not)
 * @param {string} [version] specific version, defaults to latest
 * @returns {Promise<import('./attack-probe').ProbeResult>}
 */
export async function probePackage(packageName, version) {
  const startedAt = Date.now();
  const unable = (reason) => ({
    status: 'unable',
    reason,
    packageName,
    version: version ?? 'latest',
    filesScanned: 0,
    bytesScanned: 0,
    durationMs: Date.now() - startedAt,
    findings: [],
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
  });

  // 1. Resolve tarball URL from the registry
  const encoded = encodeURIComponent(packageName);
  const doc = await fetchJson(`${REGISTRY_BASE}/${encoded}`);
  if (!doc) return unable('registry_fetch_failed');

  const distTags = doc['dist-tags'] ?? {};
  const resolvedVersion = version && version !== 'latest'
    ? version
    : (distTags.latest ?? null);
  if (!resolvedVersion) return unable('no_version_found');

  const versions = doc.versions ?? {};
  const versionDoc = versions[resolvedVersion];
  const tarballUrl = versionDoc?.dist?.tarball;
  if (!tarballUrl) return unable('no_tarball_url');

  // 2. Download tarball
  const tarball = await downloadBuffer(tarballUrl, MAX_TARBALL_BYTES);
  if (!tarball) return unable('tarball_download_failed');

  // 3. Extract and scan in a temp dir (defence-in-depth; we never execute)
  const workDir = join(tmpdir(), `mastyf-probe-${randomBytes(8).toString('hex')}`);
  const findings = [];
  let filesScanned = 0;
  let bytesScanned = 0;

  try {
    await mkdir(workDir, { recursive: true });

    const gunzipped = await new Promise((resolve, reject) => {
      const chunks = [];
      const gz = createGunzip();
      gz.on('data', (c) => chunks.push(c));
      gz.on('end', () => resolve(Buffer.concat(chunks)));
      gz.on('error', reject);
      gz.end(tarball);
    });

    const entries = parseTar(gunzipped);
    if (entries.length === 0) return unable('empty_tarball');

    for (const entry of entries) {
      if (filesScanned >= MAX_FILES || findings.length >= MAX_FINDINGS) break;
      // npm tarballs nest everything under package/
      const relPath = entry.path.replace(/^package\//, '');
      if (!relPath || relPath.includes('node_modules/')) continue;
      const base = relPath.split('/').pop() || '';

      if (base === 'package.json') {
        scanPackageJson(relPath, entry.content, findings);
        filesScanned++;
        continue;
      }
      if (!isScannable(relPath)) continue;
      if (entry.content.length > MAX_FILE_BYTES) {
        filesScanned++;
        continue; // too large to scan safely
      }

      try {
        await writeFile(join(workDir, relPath.replace(/[^\w./-]/g, '_')), entry.content, { flag: 'wx' }).catch(() => {});
      } catch { /* extraction is best-effort; scanning happens in memory */ }

      scanContent(relPath, entry.content, findings);
      filesScanned++;
      bytesScanned += entry.content.length;
    }
  } catch (err) {
    return unable(`extract_failed: ${err?.message ?? 'unknown'}`);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  return {
    status: 'ok',
    packageName,
    version: resolvedVersion,
    filesScanned,
    bytesScanned,
    durationMs: Date.now() - startedAt,
    findings: findings.slice(0, MAX_FINDINGS),
    counts,
  };
}

/**
 * Convert probe result into the behavioralIntegrity dimension score.
 * Clean probe = 90 (static scan cannot prove runtime safety, so never 100).
 * Findings penalise by severity; unable probe = 50 (neutral — no penalty).
 */
export function behavioralScoreFromProbe(probe) {
  if (!probe || probe.status !== 'ok') return 50;
  let score = 90;
  for (const f of probe.findings) {
    if (f.severity === 'critical') score -= 40;
    else if (f.severity === 'high') score -= 25;
    else if (f.severity === 'medium') score -= 12;
    else score -= 5;
  }
  return Math.max(0, score);
}
