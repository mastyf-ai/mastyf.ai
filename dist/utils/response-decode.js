/**
 * Decode response text before DLP inspection (HTML entities, bounded URL decode, TR39 confusables).
 */
import { normalizeConfusables } from './confusables.js';
const HTML_ENTITIES = {
    '&quot;': '"',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&#39;': "'",
    '&apos;': "'",
};
const NAMED_ENTITY_RE = /&(quot|amp|lt|gt|apos|#39);/gi;
const NUMERIC_ENTITY_RE = /&#x([0-9a-fA-F]+);|&#(\d+);/g;
/** Max passes / length for decode (DoS guard). */
const MAX_DECODE_CHARS = 512_000;
function decodeHtmlEntities(input) {
    let out = input.replace(NAMED_ENTITY_RE, (m) => {
        const key = m.toLowerCase();
        return HTML_ENTITIES[key] ?? m;
    });
    out = out.replace(NUMERIC_ENTITY_RE, (_, hex, dec) => {
        const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff)
            return _;
        try {
            return String.fromCodePoint(code);
        }
        catch {
            return _;
        }
    });
    return out;
}
function tryPercentDecodeOnce(input) {
    if (!/%[0-9a-fA-F]{2}/.test(input))
        return null;
    try {
        return decodeURIComponent(input.replace(/\+/g, ' '));
    }
    catch {
        return null;
    }
}
/**
 * Prepare response body for DLP scanning — decodes common encoding evasions.
 */
export function decodeResponseForInspection(raw, opts) {
    const passes = [];
    if (!raw || raw.length > MAX_DECODE_CHARS) {
        return { text: raw?.slice(0, MAX_DECODE_CHARS) ?? '', decoded: false, passes };
    }
    let text = raw;
    for (let pass = 0; pass < 3; pass++) {
        const html = decodeHtmlEntities(text);
        if (html === text)
            break;
        if (pass === 0)
            passes.push('html-entities');
        text = html;
    }
    const urlDecoded = tryPercentDecodeOnce(text);
    if (urlDecoded && urlDecoded !== text && urlDecoded.length <= MAX_DECODE_CHARS) {
        passes.push('url-decode');
        text = urlDecoded;
    }
    if (opts?.unicodeStrict !== false) {
        const normalized = normalizeConfusables(text);
        if (normalized !== text) {
            passes.push('confusables-tr39');
            text = normalized;
        }
        const nfkc = text.normalize('NFKC');
        if (nfkc !== text) {
            passes.push('nfkc');
            text = nfkc;
        }
    }
    return { text, decoded: passes.length > 0, passes };
}
//# sourceMappingURL=response-decode.js.map