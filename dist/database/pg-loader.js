let pgModule = null;
/** Load optional `pg` dependency (install with `pnpm add pg` when using PostgreSQL). */
export async function loadPg() {
    if (!pgModule) {
        try {
            pgModule = await import('pg');
        }
        catch {
            throw new Error('PostgreSQL support requires the optional `pg` package. Install it (`pnpm add pg`) and set DB_TYPE=postgres with DATABASE_URL.');
        }
    }
    return pgModule;
}
//# sourceMappingURL=pg-loader.js.map