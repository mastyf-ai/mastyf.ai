/**
 * Extension points for the proxy. Modules named in MASTYF_AI_EXTENSIONS (comma-separated package names
 * or file paths) can observe tool traffic, add checks and add CLI commands. With none configured, every
 * call here does nothing.
 */
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
import { getLicenseClient } from '../license/license-client.js';
import { walkStringLeaves } from '../policy/arg-leaf-walker.js';
import { defaultControlPlaneUrl } from '../constants/cloud-url.js';
import { deobfuscateRecursive } from '../utils/payload-normalizer.js';
import { Logger } from '../utils/logger.js';
let extensions = [];
function moduleUrl(spec) {
    return isAbsolute(spec) || spec.startsWith('.') ? pathToFileURL(spec).href : spec;
}
/** A configured extension that can't load stops the CLI, so nobody runs without what they asked for. */
export async function loadExtensions(program, specs = process.env['MASTYF_AI_EXTENSIONS'] ?? '') {
    const host = {
        logger: Logger,
        license: getLicenseClient(),
        walkStringLeaves,
        deobfuscateRecursive,
        defaultControlPlaneUrl,
    };
    for (const spec of specs.split(',').map((s) => s.trim()).filter(Boolean)) {
        try {
            const mod = (await import(moduleUrl(spec)));
            const extension = mod.createExtension(host);
            extension.registerCommands?.(program);
            extensions.push(extension);
        }
        catch (err) {
            console.error(`Could not load extension ${spec}: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    }
}
export async function startExtensions() {
    if (extensions.length === 0)
        return;
    const license = getLicenseClient();
    if (license.isEnabled())
        await license.start();
    for (const extension of extensions)
        await extension.start?.();
}
export function setExtensionsForTests(list) {
    extensions = list;
}
function each(where, fn) {
    for (const extension of extensions) {
        try {
            fn(extension);
        }
        catch (err) {
            Logger.warn(`[extensions] ${extension.name} ${where} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
function firstBlock(check) {
    for (const extension of extensions) {
        const block = check(extension);
        if (block)
            return block;
    }
    return null;
}
export function setExtensionBlockListener(listener) {
    each('setBlockListener', (e) => e.setBlockListener?.(listener));
}
export function observeToolResult(event) {
    each('observeToolResult', (e) => e.observeToolResult?.(event));
}
export function observeToolList(serverName, tools) {
    each('observeToolList', (e) => e.observeToolList?.(serverName, tools));
}
export function observePublishedContent(method, result) {
    each('observePublishedContent', (e) => e.observePublishedContent?.(method, result));
}
export function applyExtensionMeta(context, meta) {
    each('applyMeta', (e) => e.applyMeta?.(context, meta));
}
export function recordToolOutput(output) {
    each('recordToolOutput', (e) => e.recordToolOutput?.(output));
}
/** A check that throws propagates, and the proxy's own error handling treats the call as failed. */
export function checkToolCall(context) {
    return firstBlock((e) => e.checkToolCall?.(context));
}
export function checkDataFlow(check) {
    return firstBlock((e) => e.checkDataFlow?.(check));
}
export function activeRequestClassifier() {
    for (const extension of extensions) {
        if (extension.requestClassifier?.enabled())
            return extension.requestClassifier;
    }
    return null;
}
//# sourceMappingURL=index.js.map