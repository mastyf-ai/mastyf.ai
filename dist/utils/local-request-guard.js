function isLoopbackHostname(hostname) {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h === '::1')
        return true;
    return /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(h);
}
/** True when the Host header names this machine's loopback interface (any port). */
export function isLoopbackHostHeader(host) {
    const value = (Array.isArray(host) ? host[0] : host)?.trim();
    if (!value)
        return false;
    let hostname;
    if (value.startsWith('[')) {
        const end = value.indexOf(']');
        if (end < 0)
            return false;
        hostname = value.slice(1, end);
        const rest = value.slice(end + 1);
        if (rest && !/^:\d{1,5}$/.test(rest))
            return false;
    }
    else {
        const m = value.match(/^([^:]+)(?::(\d{1,5}))?$/);
        if (!m)
            return false;
        hostname = m[1];
    }
    return isLoopbackHostname(hostname);
}
/**
 * True when Origin shows the request came from a web page that isn't on this machine.
 * "null" (sandboxed iframes, data: and file: pages) and unparsable values count as cross-site.
 * Non-web schemes (vscode-file://, vscode-webview://, app://) can't be set by a web page.
 */
export function isCrossSiteBrowserOrigin(origin) {
    const value = (Array.isArray(origin) ? origin[0] : origin)?.trim();
    if (value === undefined || value === '')
        return false;
    if (value === 'null')
        return true;
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return true;
    }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol))
        return false;
    return !isLoopbackHostname(url.hostname);
}
/**
 * Reason to refuse a request to a local-only endpoint, or null when it may proceed.
 * `requireLoopbackHost` is false where the endpoint has its own authentication and may be
 * reached through a real hostname (a dashboard bound beyond loopback with an API key).
 */
export function localOnlyRequestError(req, opts) {
    if (isCrossSiteBrowserOrigin(req.headers.origin)) {
        return 'Cross-site browser requests are not allowed on this endpoint';
    }
    if (opts.requireLoopbackHost && !isLoopbackHostHeader(req.headers.host)) {
        return 'Host must be localhost or 127.0.0.1 on this endpoint';
    }
    return null;
}
//# sourceMappingURL=local-request-guard.js.map