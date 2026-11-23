/**
 * Egress classifier — tells harmless outbound calls apart from real data egress, so the
 * session exfil-chain detectors (session-flow-guard, session-chain-detector) don't block
 * ordinary agent work such as "read a file, then look something up on GitHub" or "read a
 * file, then post a status message".
 *
 * It only ever *relaxes* a block, so it fails closed: a call is 'safe-read' or 'messaging'
 * only when its arguments match a narrow, fully-known shape, and everything else is
 * 'egress' (the callers keep blocking it). Shapes are allowlisted rather than scanned for
 * bad patterns, because every "looks like a host" heuristic has a way around it.
 *
 *  - 'safe-read'  A bounded GET/HEAD to a public read-only host. The arguments may hold only:
 *                 the URL (top-level `url` or `uri`, the whole value a plain https URL on the
 *                 exact host list), the method, bounded `headers`, flat `params`, and a few
 *                 harmless settings (`timeout`, `format`, …) with tiny plain values. Any other
 *                 argument means 'egress'. `strict` (after a sensitive read in the same
 *                 session) tightens every limit and allows only content-negotiation headers.
 *  - 'messaging'  A short message to a person or channel (it names a recipient) with no URL
 *                 anywhere in its arguments and no destination or attachment key at any
 *                 depth. Callers decide what to allow; session-flow-guard only lets it
 *                 through (flagged for review) after a non-sensitive read, and
 *                 MASTYF_AI_FLOW_STRICT_MESSAGING=true turns that off.
 *  - 'egress'     Everything else.
 *
 * Note: this file was missing from commit 6d9905f6, which added its two callers. It was
 * rewritten from the callers' contract: they relax a block only for 'safe-read' and
 * (after a plain read) 'messaging'.
 */
import { walkStringLeaves } from './arg-leaf-walker.js';
/**
 * Public hosts whose GET/HEAD endpoints only return data. Exact hostname match, so
 * `api.github.com.evil.example` or `evil.github.io` never qualify. Deliberately absent:
 * Google (a GET to Google Forms submits data), localhost (local services may act on a GET),
 * and echo/test services (httpbin, request bins).
 */
const READ_ONLY_HOSTS = new Set([
    'api.github.com',
    'github.com',
    'raw.githubusercontent.com',
    'registry.npmjs.org',
    'www.npmjs.com',
    'registry.yarnpkg.com',
    'pypi.org',
    'docs.python.org',
    'developer.mozilla.org',
    'stackoverflow.com',
]);
/** Tools that fetch with GET when no method is given. Others (e.g. http_request) must say GET. */
const GET_BY_DEFAULT_TOOLS = new Set(['fetch', 'fetch_url', 'http_get', 'web_fetch', 'get_url', 'read_url']);
/** A tool name with one of these can't be a read, whatever its arguments say. */
const WRITE_VERB = /(?:^|[_\-.])(?:post|put|patch|delete|upload|send|webhook|submit|create|write|forward|transmit|publish)(?:$|[_\-.])/i;
// The only top-level arguments a safe read may have. Anything else is 'egress'.
const URL_KEYS = new Set(['url', 'uri']);
const METHOD_KEYS = new Set(['method', 'httpMethod', 'http_method', 'verb']);
const HEADER_KEYS = new Set(['headers', 'header']);
const PARAMS_KEYS = new Set(['params', 'query', 'query_params', 'queryParams', 'search_params', 'searchParams']);
/** Harmless settings: their values must be numbers, booleans or short plain words. */
const SETTING_KEYS = new Set([
    'timeout',
    'timeout_ms',
    'timeoutMs',
    'format',
    'max_length',
    'maxLength',
    'start_index',
    'startIndex',
    'raw',
    'encoding',
]);
const PLAIN_WORD = /^[a-z0-9_-]{0,32}$/i;
/** Header names allowed after a sensitive read (no Authorization, nothing custom). */
const SAFE_HEADER_NAMES = new Set([
    'accept',
    'accept-language',
    'accept-encoding',
    'user-agent',
    'if-none-match',
    'if-modified-since',
    'cache-control',
]);
/** Headers that change where, or through what, a request is sent. Never allowed. */
const ROUTING_HEADER = /^(?:host|forwarded|x-forwarded-.*|x-original-.*|x-host|proxy-.*|via)$/i;
/** Header names are tokens; anything else (spaces, colons, dots) is suspicious. */
const HEADER_NAME = /^[a-z0-9-]{1,40}$/i;
const MESSAGING_TOOL = /(?:^|[_\-.])(?:message|messages|email|mail|dm|chat|reply|comment|notify|notification|slack|teams)(?:$|[_\-.])/i;
const NOT_MESSAGING_TOOL = /(?:^|[_\-.])(?:webhook|http|https|request|fetch|url|upload|callback|curl)(?:$|[_\-.])/i;
const RECIPIENT_KEY = /^(?:to|cc|bcc|recipients?|channel|channel_id|channelId|chat_id|chatId|conversation|conversation_id|thread|thread_id|user|user_id|userId|email|address)$/i;
const DESTINATION_KEY = /^(?:urls?|uris?|endpoints?|webhooks?|webhook_?url|webhookUrl|callbacks?|callback_?url|hosts?|hostname|servers?|proxy|proxies|domain|origin|redirect|forward_to)$/i;
const ATTACHMENT_KEY = /^(?:attachments?|files?|file_path|filePath|path|paths|blocks_url|image_url|media_url)$/i;
/** The whole serialized message, keys included. A status update fits; a pasted file doesn't. */
const MAX_MESSAGE_JSON = 1200;
/** Any "scheme://" (http, https, ftp, …): the argument names a destination. */
const HAS_SCHEME = /[a-z][a-z0-9+.-]*:\/\//i;
/**
 * The only URL shape accepted for a safe read: https, then a hostname made of hostname
 * characters only, then the end or a path/query/fragment. No userinfo ("@"), port, backslash
 * or punctuation in the authority, which different URL parsers split differently
 * ("https://api.github.com,@evil.example/x" is evil.example to some of them).
 */
const STRICT_HTTPS_URL = /^https:\/\/([a-z0-9.-]+)(?:[/?#][^\s\\]*)?$/i;
const NORMAL = { maxUrlLength: 2048, maxQueryLength: 512, maxOpaqueRun: 63, maxHeaderText: 512 };
const STRICT = { maxUrlLength: 512, maxQueryLength: 128, maxOpaqueRun: 23, maxHeaderText: 256 };
export function classifyEgress(toolName, args, options = {}) {
    if (isSafeRead(toolName, args ?? {}, options.strict ? STRICT : NORMAL, !!options.strict))
        return 'safe-read';
    if (isMessaging(toolName, args ?? {}))
        return 'messaging';
    return 'egress';
}
// ------------------------------------------------------------------ safe-read
function isSafeRead(toolName, args, limits, strict) {
    const name = toolName.toLowerCase();
    if (WRITE_VERB.test(name))
        return false;
    let url = null;
    let method = null;
    let paramsText = 0;
    for (const [key, value] of Object.entries(args)) {
        if (isEmpty(value))
            continue;
        if (URL_KEYS.has(key)) {
            // Exactly one URL, and it is the whole value.
            if (url !== null || typeof value !== 'string')
                return false;
            url = value.trim();
        }
        else if (METHOD_KEYS.has(key)) {
            if (method !== null || typeof value !== 'string')
                return false;
            method = value.trim().toUpperCase();
        }
        else if (HEADER_KEYS.has(key)) {
            if (!headersAreBounded(value, limits, strict))
                return false;
        }
        else if (PARAMS_KEYS.has(key)) {
            const length = boundedParamsLength(value, limits);
            if (length === null)
                return false;
            paramsText += length;
        }
        else if (SETTING_KEYS.has(key)) {
            if (!isPlainSetting(value))
                return false;
        }
        else {
            // Unknown argument: it could be a body, a second destination, or smuggled data.
            return false;
        }
    }
    if (method === null) {
        if (!GET_BY_DEFAULT_TOOLS.has(name))
            return false;
    }
    else if (method !== 'GET' && method !== 'HEAD') {
        return false;
    }
    if (url === null || !isBoundedReadUrl(url, limits))
        return false;
    return paramsText <= limits.maxQueryLength;
}
function isBoundedReadUrl(raw, limits) {
    if (raw.length > limits.maxUrlLength)
        return false;
    // The whole value must be one plain https URL, and both readings of its host must agree.
    const strict = STRICT_HTTPS_URL.exec(raw);
    if (!strict)
        return false;
    const host = strict[1].toLowerCase();
    if (!READ_ONLY_HOSTS.has(host))
        return false;
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return false;
    }
    if (url.protocol !== 'https:')
        return false;
    if (url.username || url.password || url.port)
        return false;
    if (url.hostname.toLowerCase() !== host)
        return false;
    if (url.search.length > limits.maxQueryLength)
        return false;
    let decoded = url.pathname + url.search + url.hash;
    try {
        decoded = decodeURIComponent(decoded);
    }
    catch {
        return false;
    }
    return longestOpaqueRun(decoded) <= limits.maxOpaqueRun;
}
/** Flat `{ name: scalar }` query params; returns their serialized length, or null to reject. */
function boundedParamsLength(value, limits) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    for (const [k, v] of Object.entries(value)) {
        if (!/^[a-z0-9_.-]{1,40}$/i.test(k))
            return null;
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
            return null;
        if (HAS_SCHEME.test(String(v)))
            return null;
    }
    const serialized = JSON.stringify(value);
    if (longestOpaqueRun(serialized) > limits.maxOpaqueRun)
        return null;
    return serialized.length;
}
function headersAreBounded(value, limits, strict) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    if (JSON.stringify(value).length > limits.maxHeaderText)
        return false;
    for (const [h, v] of Object.entries(value)) {
        if (!HEADER_NAME.test(h) || ROUTING_HEADER.test(h))
            return false;
        if (typeof v !== 'string' && typeof v !== 'number')
            return false;
        // After a sensitive read only plain content-negotiation headers (no Authorization).
        if (strict && !SAFE_HEADER_NAMES.has(h.toLowerCase()))
            return false;
        if (HAS_SCHEME.test(String(v)))
            return false;
        // A credential is long and opaque by nature, and only reaches the read-only host.
        if (h.toLowerCase() === 'authorization')
            continue;
        if (longestOpaqueRun(String(v)) > limits.maxOpaqueRun)
            return false;
    }
    return true;
}
function isPlainSetting(value) {
    if (typeof value === 'boolean')
        return true;
    if (typeof value === 'number')
        return Number.isFinite(value);
    return typeof value === 'string' && PLAIN_WORD.test(value);
}
/** Longest run of characters that could be encoded data (base64, base64url, hex). */
function longestOpaqueRun(text) {
    let longest = 0;
    for (const match of text.matchAll(/[A-Za-z0-9+/=_-]+/g)) {
        // Path separators split ordinary paths; only an unbroken run counts.
        for (const segment of match[0].split('/'))
            longest = Math.max(longest, segment.length);
    }
    return longest;
}
// ------------------------------------------------------------------ messaging
function isMessaging(toolName, args) {
    const name = toolName.toLowerCase();
    if (!MESSAGING_TOOL.test(name) || NOT_MESSAGING_TOOL.test(name))
        return false;
    // Short: the whole argument object, key names included.
    if (JSON.stringify(args).length > MAX_MESSAGE_JSON)
        return false;
    const keys = Object.keys(args);
    if (!keys.some((key) => RECIPIENT_KEY.test(key) && !isEmpty(args[key])))
        return false;
    const allKeys = [...keys, ...keys.flatMap((key) => nestedKeys(args[key]))];
    if (allKeys.some((key) => DESTINATION_KEY.test(key) || ATTACHMENT_KEY.test(key)))
        return false;
    // "No URL destination": not in any field or key, including the message text.
    if (allKeys.some((key) => HAS_SCHEME.test(key)))
        return false;
    return !walkStringLeaves(args).some((leaf) => HAS_SCHEME.test(leaf.value));
}
// ------------------------------------------------------------------ helpers
function isEmpty(value) {
    if (value === null || value === undefined)
        return true;
    if (typeof value === 'string')
        return value.trim() === '';
    if (Array.isArray(value))
        return value.length === 0;
    if (typeof value === 'object')
        return Object.keys(value).length === 0;
    return false;
}
/** Every object key below a value, at any depth. */
function nestedKeys(value) {
    if (Array.isArray(value))
        return value.flatMap(nestedKeys);
    if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([k, v]) => [k, ...nestedKeys(v)]);
    }
    return [];
}
//# sourceMappingURL=egress-classifier.js.map