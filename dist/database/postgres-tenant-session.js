export function isPostgresRlsEnabled() {
    return process.env['MASTYF_AI_PG_RLS_ENABLED'] === 'true';
}
export async function withPostgresTenantSession(pool, tenantId, fn) {
    const client = await pool.connect();
    try {
        await client.query(`SET LOCAL app.tenant_id = $1`, [tenantId]);
        return await fn(client);
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=postgres-tenant-session.js.map