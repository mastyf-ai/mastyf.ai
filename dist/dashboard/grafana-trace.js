/** Join a Grafana/Tempo template to a receipt trace_id. Never invents a href. */
export function grafanaTraceHref(template, traceId) {
    if (!template || !traceId)
        return null;
    if (template.includes('{trace_id}')) {
        return template.split('{trace_id}').join(encodeURIComponent(traceId));
    }
    const join = template.includes('?') ? '&' : '?';
    return `${template}${join}traceId=${encodeURIComponent(traceId)}`;
}
/** Local LGTM Tempo explore (deploy/observability/README.md). */
export const LOCAL_OBS_GRAFANA_TRACE_URL = 'http://localhost:3001/explore?orgId=1&left=%7B%22datasource%22:%22Tempo%22,%22queries%22:%5B%7B%22query%22:%22{trace_id}%22%7D%5D%7D';
//# sourceMappingURL=grafana-trace.js.map