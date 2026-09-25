export function extractRequestGeoContext(headers) {
    const hourUtc = new Date().getUTCHours();
    if (!headers)
        return { hourUtc };
    const region = headerValue(headers['x-mastyf-ai-geo-region'])
        ?? headerValue(headers['cf-ipcountry'])
        ?? headerValue(headers['x-vercel-ip-country'])
        ?? headerValue(headers['x-geo-country']);
    return {
        geoRegion: region?.toUpperCase(),
        hourUtc,
    };
}
function headerValue(v) {
    if (!v)
        return undefined;
    const s = Array.isArray(v) ? v[0] : v;
    return s?.trim() || undefined;
}
export function applyGeoToCallContext(ctx, headers) {
    const geo = extractRequestGeoContext(headers);
    return { ...ctx, ...geo };
}
//# sourceMappingURL=request-geo-context.js.map