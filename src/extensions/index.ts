/**
 * Extension points for the proxy. Modules named in MASTYF_AI_EXTENSIONS (comma-separated package names
 * or file paths) can observe tool traffic, add checks and add CLI commands. With none configured, every
 * call here does nothing.
 */
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
import type { Command } from 'commander';
import { getLicenseClient, type LicenseClient } from '../license/license-client.js';
import type { CallContext } from '../policy/policy-types.js';
import { walkStringLeaves } from '../policy/arg-leaf-walker.js';
import { defaultControlPlaneUrl } from '../constants/cloud-url.js';
import { deobfuscateRecursive } from '../utils/payload-normalizer.js';
import { Logger } from '../utils/logger.js';

export interface ToolResultEvent {
  tenantId?: string;
  sessionId?: string;
  serverName: string;
  toolName: string;
  result: unknown;
}

export interface ExtensionBlock {
  rule: string;
  reason: string;
}

export interface BlockEvent extends ExtensionBlock {
  tenantId?: string;
  sessionId?: string;
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface FlowCheck {
  sessionKey: string;
  toolName: string;
  args?: Record<string, unknown>;
}

export interface ToolOutput {
  sessionKey: string;
  toolName: string;
  output: unknown;
}

export interface RequestVerdict {
  block: boolean;
  /** Blocked because the classifier wasn't sure, rather than because it found an attack. */
  unsure: boolean;
  confidence: number;
  latencyMs: number;
  reasoning: string;
}

export interface RequestClassifier {
  /** Whether it should decide calls in place of the LLM. */
  enabled(): boolean;
  /** Null when no verdict could be had. */
  classify(toolName: string, args: Record<string, unknown>): Promise<RequestVerdict | null>;
}

export interface ProxyExtension {
  name: string;
  /** Before the proxy serves anything. It may refuse to let the proxy start by exiting. */
  start?(): void | Promise<void>;
  registerCommands?(program: Command): void;
  setBlockListener?(listener: ((event: BlockEvent) => void) | null): void;
  observeToolResult?(event: ToolResultEvent): void;
  observeToolList?(serverName: string, tools: readonly { name?: unknown; annotations?: unknown }[]): void;
  observePublishedContent?(method: string, result: unknown): void;
  applyMeta?(context: CallContext, meta: Record<string, unknown> | undefined): void;
  checkToolCall?(context: CallContext): ExtensionBlock | null;
  checkDataFlow?(check: FlowCheck): ExtensionBlock | null;
  recordToolOutput?(output: ToolOutput): void;
  requestClassifier?: RequestClassifier;
}

/** What the proxy lends an extension. */
export interface ExtensionHost {
  logger: Pick<typeof Logger, 'debug' | 'info' | 'warn' | 'error'>;
  license: LicenseClient;
  walkStringLeaves: typeof walkStringLeaves;
  deobfuscateRecursive: typeof deobfuscateRecursive;
  defaultControlPlaneUrl: typeof defaultControlPlaneUrl;
}

let extensions: ProxyExtension[] = [];

function moduleUrl(spec: string): string {
  return isAbsolute(spec) || spec.startsWith('.') ? pathToFileURL(spec).href : spec;
}

/** A configured extension that can't load stops the CLI, so nobody runs without what they asked for. */
export async function loadExtensions(program: Command, specs = process.env['MASTYF_AI_EXTENSIONS'] ?? ''): Promise<void> {
  const host: ExtensionHost = {
    logger: Logger,
    license: getLicenseClient(),
    walkStringLeaves,
    deobfuscateRecursive,
    defaultControlPlaneUrl,
  };
  for (const spec of specs.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      const mod = (await import(moduleUrl(spec))) as { createExtension: (h: ExtensionHost) => ProxyExtension };
      const extension = mod.createExtension(host);
      extension.registerCommands?.(program);
      extensions.push(extension);
    } catch (err) {
      console.error(`Could not load extension ${spec}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
}

export async function startExtensions(): Promise<void> {
  if (extensions.length === 0) return;
  const license = getLicenseClient();
  if (license.isEnabled()) await license.start();
  for (const extension of extensions) await extension.start?.();
}

export function setExtensionsForTests(list: ProxyExtension[]): void {
  extensions = list;
}

function each(where: string, fn: (extension: ProxyExtension) => void): void {
  for (const extension of extensions) {
    try {
      fn(extension);
    } catch (err) {
      Logger.warn(`[extensions] ${extension.name} ${where} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function firstBlock(check: (extension: ProxyExtension) => ExtensionBlock | null | undefined): ExtensionBlock | null {
  for (const extension of extensions) {
    const block = check(extension);
    if (block) return block;
  }
  return null;
}

export function setExtensionBlockListener(listener: ((event: BlockEvent) => void) | null): void {
  each('setBlockListener', (e) => e.setBlockListener?.(listener));
}

export function observeToolResult(event: ToolResultEvent): void {
  each('observeToolResult', (e) => e.observeToolResult?.(event));
}

export function observeToolList(serverName: string, tools: readonly { name?: unknown; annotations?: unknown }[]): void {
  each('observeToolList', (e) => e.observeToolList?.(serverName, tools));
}

export function observePublishedContent(method: string, result: unknown): void {
  each('observePublishedContent', (e) => e.observePublishedContent?.(method, result));
}

export function applyExtensionMeta(context: CallContext, meta: Record<string, unknown> | undefined): void {
  each('applyMeta', (e) => e.applyMeta?.(context, meta));
}

export function recordToolOutput(output: ToolOutput): void {
  each('recordToolOutput', (e) => e.recordToolOutput?.(output));
}

/** A check that throws propagates, and the proxy's own error handling treats the call as failed. */
export function checkToolCall(context: CallContext): ExtensionBlock | null {
  return firstBlock((e) => e.checkToolCall?.(context));
}

export function checkDataFlow(check: FlowCheck): ExtensionBlock | null {
  return firstBlock((e) => e.checkDataFlow?.(check));
}

export function activeRequestClassifier(): RequestClassifier | null {
  for (const extension of extensions) {
    if (extension.requestClassifier?.enabled()) return extension.requestClassifier;
  }
  return null;
}
