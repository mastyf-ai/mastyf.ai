/** Parse MCP SSE `endpoint` event into message URL + session id. */
export function parseEndpointFromSse(data, baseUrl) {
    const lines = data.split('\n');
    let currentEvent = null;
    for (const line of lines) {
        if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
        }
        else if (line.startsWith('data: ') && currentEvent === 'endpoint') {
            const endpointData = line.slice(6).trim();
            const m = endpointData.match(/sessionId=([^&\s]+)/);
            if (!m)
                return null;
            const sessionId = m[1];
            try {
                const messageUrl = endpointData.startsWith('http')
                    ? new URL(endpointData)
                    : new URL(endpointData, baseUrl);
                return { sessionId, messageUrl };
            }
            catch {
                const messageUrl = new URL(`/message?sessionId=${sessionId}`, baseUrl);
                return { sessionId, messageUrl };
            }
        }
    }
    return null;
}
export function sseProbePaths(baseUrl) {
    const paths = ['/', '/sse', baseUrl.pathname || '/'].filter((p, i, arr) => arr.indexOf(p) === i);
    return paths;
}
//# sourceMappingURL=sse-endpoint.js.map