export function validateFixtureCount(fixtures) {
    if (!Array.isArray(fixtures) || fixtures.length < 20 || fixtures.length > 50) {
        throw new Error('Parity harness requires 20-50 fixtures');
    }
}
export function extractBlocked(responseBody, statusCode) {
    if (statusCode >= 400)
        return true;
    if (!responseBody || typeof responseBody !== 'object')
        return false;
    const message = String(responseBody?.error?.message || '');
    return /blocked|denied/i.test(message);
}
export async function compareParity(fixtures, legacyRunner, dataPlaneRunner, legacyProxy, dataPlane) {
    validateFixtureCount(fixtures);
    const mismatches = [];
    let compared = 0;
    for (const fx of fixtures) {
        const [legacy, dp] = await Promise.all([legacyRunner(fx), dataPlaneRunner(fx)]);
        compared += 1;
        if (legacy.blocked !== dp.blocked) {
            mismatches.push({
                id: fx.id,
                toolName: fx.toolName,
                legacyBlocked: legacy.blocked,
                dataPlaneBlocked: dp.blocked,
                legacyStatus: legacy.status,
                dataPlaneStatus: dp.status,
            });
        }
    }
    return {
        summary: {
            fixtures: fixtures.length,
            compared,
            mismatches: mismatches.length,
            legacyProxy,
            dataPlane,
        },
        mismatches,
    };
}
//# sourceMappingURL=parity-harness.js.map