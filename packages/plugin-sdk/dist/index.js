/**
 * MCP Mastyf AI Plugin SDK v4.0 — detector plugins + industry-standard hooks.
 * @see docs/PLUGIN_SDK.md
 */
export function createDetectorPlugin(opts) {
    return {
        name: opts.name,
        version: opts.version,
        onLoad: opts.onLoad,
        onUnload: opts.onUnload,
        scanArguments: opts.scanArguments,
    };
}
export const PLUGIN_SDK_VERSION = '4.1.1';
/** Build MTX v1 record JSON for threat mesh contribution from a plugin finding. */
export function exportMtxRecord(params) {
    const record = {
        mtxVersion: '1.0',
        toolName: params.toolName,
        argPatternHash: hashHex(params.argFingerprint),
        category: params.category,
        blockReason: params.blockReason,
        contributedAt: new Date().toISOString(),
    };
    return JSON.stringify(record);
}
/** POST certification attestation to Mastyf AI cloud registry (or custom URL). */
export async function submitCertificationAttestation(payload, registryUrl = process.env.MASTYF_AI_CERT_REGISTRY_URL ?? 'https://mastyf-ai-cloud/api/v1/certifications', apiKey) {
    const res = await fetch(registryUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
    });
    let body;
    try {
        body = await res.json();
    }
    catch {
        body = undefined;
    }
    return { ok: res.ok, status: res.status, body };
}
function hashHex(input) {
    if (typeof globalThis.crypto?.subtle !== 'undefined') {
        // Browser / modern Node — sync fallback for SDK simplicity
    }
    let h = 0;
    for (let i = 0; i < input.length; i++) {
        h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(16).padStart(16, '0');
}
//# sourceMappingURL=index.js.map