const checks = [];
export function registerReadinessCheck(check) {
    checks.push(check);
}
export async function runReadinessChecks() {
    const results = {};
    let ready = true;
    for (let i = 0; i < checks.length; i++) {
        const name = `check_${i}`;
        try {
            const result = await checks[i]();
            results[name] = result.ok ? 'ok' : (result.detail || 'failed');
            if (!result.ok)
                ready = false;
        }
        catch (err) {
            results[name] = err instanceof Error ? err.message : 'error';
            ready = false;
        }
    }
    return { ready, checks: results };
}
//# sourceMappingURL=readiness.js.map