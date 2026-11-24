/**
 * Guards for HTTP endpoints that are meant for local, non-browser clients (an IDE or agent on
 * this machine). Binding to 127.0.0.1 is not enough on its own:
 *  - DNS rebinding points an attacker's domain at 127.0.0.1, so the browser sends that domain
 *    as the Host header; requiring a loopback Host stops it.
 *  - A web page can POST to http://127.0.0.1:<port> directly (a "simple" request needs no CORS
 *    preflight and still runs server-side); browsers always send Origin on such a POST, so
 *    refusing non-local web origins stops it.
 * Local tools (curl, IDE extension hosts, Node clients) send no Origin, or a non-web one such as
 * vscode-file://, and a loopback Host.
 */
import type { IncomingMessage } from 'http';
/** True when the Host header names this machine's loopback interface (any port). */
export declare function isLoopbackHostHeader(host: string | string[] | undefined): boolean;
/**
 * True when Origin shows the request came from a web page that isn't on this machine.
 * "null" (sandboxed iframes, data: and file: pages) and unparsable values count as cross-site.
 * Non-web schemes (vscode-file://, vscode-webview://, app://) can't be set by a web page.
 */
export declare function isCrossSiteBrowserOrigin(origin: string | string[] | undefined): boolean;
/**
 * Reason to refuse a request to a local-only endpoint, or null when it may proceed.
 * `requireLoopbackHost` is false where the endpoint has its own authentication and may be
 * reached through a real hostname (a dashboard bound beyond loopback with an API key).
 */
export declare function localOnlyRequestError(req: Pick<IncomingMessage, 'headers'>, opts: {
    requireLoopbackHost: boolean;
}): string | null;
//# sourceMappingURL=local-request-guard.d.ts.map