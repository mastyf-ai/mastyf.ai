import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type {
  ToolDefinition, ToolManifestEntry, ManifestVerifyResult
} from "./types.js";

const MANIFEST_DIR = join(homedir(), ".mastyf-ai");
const DEFAULT_MANIFEST_PATH = join(MANIFEST_DIR, "tool-manifest.json");
const SECRET_PATH = join(MANIFEST_DIR, ".local-secret");

const MIN_SECRET_LENGTH = 32;

export class ManifestSecretError extends Error {
  override name = "ManifestSecretError";
}

/** @internal */
let secretOverride: string | null = null;
/** @internal */
let manifestPathOverride: string | null = null;

/** @internal */
export function resetManifestSecretForTests(): void {
  secretOverride = null;
  manifestPathOverride = null;
}

/** @internal */
export function setManifestSecretForTests(secret: string): void {
  secretOverride = secret;
}

/** @internal */
export function setManifestPathForTests(path: string | null): void {
  manifestPathOverride = path;
}

function manifestPath(): string {
  return manifestPathOverride
    ?? process.env["MASTYF_AI_MANIFEST_PATH"]
    ?? DEFAULT_MANIFEST_PATH;
}

function ensureManifestDir(): void {
  const dir = dirname(manifestPath());
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function manifestSecretRequired(): boolean {
  return process.env["MASTYF_AI_MANIFEST_REQUIRE_SECRET"] === "true"
    || process.env["MASTYF_AI_STRICT_MODE"] === "true";
}

function ensureSecretDir(): void {
  if (!existsSync(MANIFEST_DIR)) {
    mkdirSync(MANIFEST_DIR, { recursive: true, mode: 0o700 });
  }
}

function readOrCreateFileSecret(): string {
  ensureSecretDir();
  if (!existsSync(SECRET_PATH)) {
    const secret = randomBytes(32).toString("hex");
    writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
    return secret;
  }
  const secret = readFileSync(SECRET_PATH, "utf8").trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new ManifestSecretError(
      `Manifest secret file ${SECRET_PATH} is invalid — regenerate or set MASTYF_AI_MANIFEST_SECRET`,
    );
  }
  return secret;
}

/**
 * Resolve HMAC secret for tool manifest pinning.
 * Priority: test override → MASTYF_AI_MANIFEST_SECRET env → ~/.mastyf-ai/.local-secret (auto-generated).
 * No hardcoded default is ever used.
 */
export function resolveManifestSecret(): string {
  if (secretOverride) return secretOverride;

  const envSecret = process.env["MASTYF_AI_MANIFEST_SECRET"]?.trim();
  if (envSecret) {
    if (envSecret.length < MIN_SECRET_LENGTH) {
      throw new ManifestSecretError(
        `MASTYF_AI_MANIFEST_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
      );
    }
    return envSecret;
  }

  if (manifestSecretRequired()) {
    throw new ManifestSecretError(
      "MASTYF_AI_MANIFEST_SECRET is required in strict mode — manifest pinning refuses a shared or default secret",
    );
  }

  return readOrCreateFileSecret();
}

function canonicalize(tool: ToolDefinition): string {
  function deepSort(obj: unknown): unknown {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(deepSort);
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = deepSort((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return JSON.stringify(deepSort({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema ?? null,
  }));
}

function hashTool(tool: ToolDefinition): string {
  return createHash("sha256")
    .update(canonicalize(tool))
    .digest("hex");
}

function hmacEntry(entry: Omit<ToolManifestEntry, "hmac">): string {
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

type ManifestStore = Record<string, ToolManifestEntry>;

function loadManifest(): ManifestStore {
  const path = manifestPath();
  ensureManifestDir();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ManifestStore;
  } catch {
    return {};
  }
}

function saveManifest(store: ManifestStore): void {
  const path = manifestPath();
  ensureManifestDir();
  writeFileSync(path, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
}

function manifestKey(serverName: string, toolName: string): string {
  return `${serverName}::${toolName}`;
}

function emptyVerifyResult(): ManifestVerifyResult {
  return {
    status: "verified",
    changedTools: [],
    newTools: [],
    removedTools: [],
    tamperedEntries: [],
  };
}

export function verifyToolDefinitions(
  tools: ToolDefinition[],
  serverName: string
): ManifestVerifyResult {
  const result = emptyVerifyResult();

  try {
    resolveManifestSecret();
  } catch (err) {
    return {
      ...result,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const store = loadManifest();

  const currentKeys = new Set<string>();

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
  } else if (result.changedTools.length > 0 || result.removedTools.length > 0) {
    result.status = "changed";
  } else if (result.tamperedEntries.length > 0) {
    result.status = "tampered";
  }

  return result;
}

export function approveToolDefinitions(
  tools: ToolDefinition[],
  serverName: string
): void {
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
