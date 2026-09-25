import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
const MANIFEST_DIR = join(homedir(), ".mastyf-ai");
const DEFAULT_MANIFEST_PATH = join(MANIFEST_DIR, "tool-manifest.json");
const SECRET_PATH = join(MANIFEST_DIR, ".local-secret");
const MIN_SECRET_LENGTH = 32;
export const MIN_MANIFEST_SECRET_LENGTH = MIN_SECRET_LENGTH;
export class ManifestSecretError extends Error {
    name = "ManifestSecretError";
}
/** @internal */
let secretOverride = null;
/** @internal */
let manifestPathOverride = null;
/** @internal */
export function resetManifestSecretForTests() {
    secretOverride = null;
    manifestPathOverride = null;
}
/** @internal */
export function setManifestSecretForTests(secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
        throw new ManifestSecretError(`Test manifest secret must be at least ${MIN_SECRET_LENGTH} characters`);
    }
    secretOverride = secret;
}
/** @internal */
export function setManifestPathForTests(path) {
    manifestPathOverride = path;
}
function manifestPath() {
    return manifestPathOverride
        ?? process.env["MASTYF_AI_MANIFEST_PATH"]
        ?? DEFAULT_MANIFEST_PATH;
}
function ensureManifestDir() {
    const dir = dirname(manifestPath());
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
}
function manifestSecretRequired() {
    return process.env["MASTYF_AI_MANIFEST_REQUIRE_SECRET"] === "true"
        || process.env["MASTYF_AI_STRICT_MODE"] === "true";
}
function ensureSecretDir() {
    if (!existsSync(MANIFEST_DIR)) {
        mkdirSync(MANIFEST_DIR, { recursive: true, mode: 0o700 });
    }
}
function readOrCreateFileSecret() {
    ensureSecretDir();
    if (!existsSync(SECRET_PATH)) {
        const secret = randomBytes(32).toString("hex");
        writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
        return secret;
    }
    const secret = readFileSync(SECRET_PATH, "utf8").trim();
    if (secret.length < MIN_SECRET_LENGTH) {
        throw new ManifestSecretError(`Manifest secret file ${SECRET_PATH} is invalid — regenerate or set MASTYF_AI_MANIFEST_SECRET`);
    }
    return secret;
}
/**
 * Resolve HMAC secret for tool manifest pinning.
 * Priority: test override → MASTYF_AI_MANIFEST_SECRET env → ~/.mastyf-ai/.local-secret (auto-generated).
 * No hardcoded default is ever used.
 */
export function resolveManifestSecret() {
    if (secretOverride)
        return secretOverride;
    const envSecret = process.env["MASTYF_AI_MANIFEST_SECRET"]?.trim();
    if (envSecret) {
        if (envSecret.length < MIN_SECRET_LENGTH) {
            throw new ManifestSecretError(`MASTYF_AI_MANIFEST_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
        }
        return envSecret;
    }
    if (manifestSecretRequired()) {
        throw new ManifestSecretError("MASTYF_AI_MANIFEST_SECRET is required in strict mode — manifest pinning refuses a shared or default secret");
    }
    return readOrCreateFileSecret();
}
function canonicalize(tool) {
    function deepSort(obj) {
        if (obj === null || typeof obj !== "object")
            return obj;
        if (Array.isArray(obj))
            return obj.map(deepSort);
        const sorted = {};
        const keys = Object.keys(obj).sort();
        for (const key of keys) {
            sorted[key] = deepSort(obj[key]);
        }
        return sorted;
    }
    return JSON.stringify(deepSort({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema ?? null,
    }));
}
function hashTool(tool) {
    return createHash("sha256")
        .update(canonicalize(tool))
        .digest("hex");
}
function hmacEntry(entry) {
    const secret = resolveManifestSecret();
    const payload = JSON.stringify({
        toolName: entry.toolName,
        serverName: entry.serverName,
        hash: entry.hash,
        approvedAt: entry.approvedAt,
        version: entry.version,
    });
    return createHmac("sha256", secret).update(payload).digest("hex");
}
function loadManifest() {
    const path = manifestPath();
    ensureManifestDir();
    if (!existsSync(path))
        return {};
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return {};
    }
}
function saveManifest(store) {
    const path = manifestPath();
    ensureManifestDir();
    writeFileSync(path, JSON.stringify(store, null, 2), {
        mode: 0o600,
    });
}
function manifestKey(serverName, toolName) {
    return `${serverName}::${toolName}`;
}
function emptyVerifyResult() {
    return {
        status: "verified",
        changedTools: [],
        newTools: [],
        removedTools: [],
        tamperedEntries: [],
    };
}
export function verifyToolDefinitions(tools, serverName) {
    const result = emptyVerifyResult();
    try {
        resolveManifestSecret();
    }
    catch (err) {
        return {
            ...result,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
        };
    }
    const store = loadManifest();
    const currentKeys = new Set();
    for (const tool of tools) {
        const key = manifestKey(serverName, tool.name);
        currentKeys.add(key);
        const currentHash = hashTool(tool);
        const existing = store[key];
        if (!existing) {
            result.newTools.push(tool.name);
            continue;
        }
        const expectedHmac = hmacEntry({
            toolName: existing.toolName,
            serverName: existing.serverName,
            hash: existing.hash,
            approvedAt: existing.approvedAt,
            version: existing.version,
        });
        if (expectedHmac !== existing.hmac) {
            result.tamperedEntries.push(tool.name);
            continue;
        }
        if (existing.hash !== currentHash) {
            result.changedTools.push(tool.name);
        }
    }
    for (const key of Object.keys(store)) {
        if (key.startsWith(`${serverName}::`) && !currentKeys.has(key)) {
            result.removedTools.push(key.replace(`${serverName}::`, ""));
        }
    }
    if (result.newTools.length > 0 && result.changedTools.length === 0
        && result.removedTools.length === 0 && result.tamperedEntries.length === 0) {
        result.status = "created";
    }
    else if (result.changedTools.length > 0 || result.removedTools.length > 0) {
        result.status = "changed";
    }
    else if (result.tamperedEntries.length > 0) {
        result.status = "tampered";
    }
    return result;
}
export function approveToolDefinitions(tools, serverName) {
    const store = loadManifest();
    const now = new Date().toISOString();
    for (const tool of tools) {
        const key = manifestKey(serverName, tool.name);
        const existing = store[key];
        const hash = hashTool(tool);
        const version = existing ? existing.version + 1 : 1;
        const entryWithoutHmac = {
            toolName: tool.name,
            serverName,
            hash,
            approvedAt: now,
            version,
        };
        store[key] = {
            ...entryWithoutHmac,
            hmac: hmacEntry(entryWithoutHmac),
        };
    }
    saveManifest(store);
}
//# sourceMappingURL=manifest.js.map