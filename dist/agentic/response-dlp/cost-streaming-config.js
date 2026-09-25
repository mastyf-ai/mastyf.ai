export function getTokensPerMinCap(_tenantId) {
    const n = parseInt(process.env['MASTYF_AI_STREAMING_TOKEN_CAP'] || process.env['MASTYF_AI_TENANT_TOKENS_PER_MIN'] || '500000', 10);
    return Number.isFinite(n) && n > 0 ? n : 500_000;
}
//# sourceMappingURL=cost-streaming-config.js.map