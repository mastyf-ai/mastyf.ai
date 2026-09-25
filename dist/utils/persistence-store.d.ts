interface HistoryDb {
    exec(sql: string): void;
    prepare(sql: string): any;
}
interface SsoConfigRow {
    id: string;
    tenant_id: string;
    provider_type: string;
    name: string;
    issuer_url: string;
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    scopes: string;
    claim_mappings: string;
    role_map: string;
    enabled: number;
    created_at: string;
    updated_at: string;
}
interface CredentialRow {
    id: string;
    tenant_id: string;
    user_id: string;
    provider_name: string;
    provider_id: string;
    credential_type: string;
    encrypted_token: string;
    encrypted_refresh_token: string | null;
    scopes: string;
    expires_at: string | null;
    created_at: string;
    metadata: string;
}
interface UserPolicyRow {
    id: string;
    tenant_id: string;
    user_id: string;
    username: string;
    roles: string;
    allowed_tools: string;
    denied_tools: string;
    rate_limit_per_minute: number;
    max_tokens_per_call: number;
    allowed_paths: string;
    denied_paths: string;
}
interface FeedRow {
    id: string;
    tenant_id: string;
    name: string;
    feed_url: string;
    enabled: number;
    last_sync: string | null;
    added_count: number;
    created_at: string;
}
export declare function getPersistenceStore(): PersistenceStore;
export declare function setPersistenceStore(store: PersistenceStore): void;
export declare class PersistenceStore {
    private db;
    private initialized;
    constructor(db: HistoryDb | null);
    attach(db: HistoryDb): void;
    private enc;
    private dec;
    initTables(): void;
    private ensure;
    getSsoConfigs(tenantId: string): SsoConfigRow[];
    getSsoConfig(tenantId: string, id: string): SsoConfigRow | null;
    saveSsoConfig(row: SsoConfigRow): void;
    deleteSsoConfig(tenantId: string, id: string): boolean;
    getCredentials(tenantId: string, providerId: string, credentialType: string): CredentialRow | null;
    saveCredential(row: CredentialRow): void;
    deleteCredentialsForUser(userId: string): boolean;
    getUserPolicies(tenantId: string): UserPolicyRow[];
    saveUserPolicy(row: UserPolicyRow): void;
    deleteUserPolicy(tenantId: string, policyId: string): boolean;
    getFeedSubscriptions(tenantId: string): FeedRow[];
    saveFeedSubscription(row: FeedRow): void;
    getCustomHooks(): Array<{
        name: string;
        code: string;
        type: string;
        priority: number;
        enabled: number;
    }>;
    saveCustomHook(name: string, code: string, type: string, priority: number): void;
    deleteCustomHook(name: string): void;
    getCorpusEntries(verifiedOnly?: boolean): Array<{
        id: string;
        tool: string;
        args: string;
        expected_action: string;
        category: string;
        description: string;
        block_rule: string | null;
        verified: number;
        created_at: string;
    }>;
    verifyCorpusEntry(id: string): void;
    rejectCorpusEntry(id: string): void;
    getCorpusRuleStats(): Array<{
        rule_name: string;
        false_positives: number;
        true_positives: number;
        last_updated: string;
    }>;
    getHighFalsePositiveRules(threshold?: number): string[];
    verifyAuditChain(): {
        ok: boolean;
        breaks: number;
        entries: number;
    };
    getUnverifiedCount(): number;
    addCorpusEntry(entry: {
        tool: string;
        args: string;
        expectedAction: string;
        category: string;
        description: string;
        blockRule?: string;
    }): string;
    appendAuditEntry(eventType: string, eventData: Record<string, unknown>): string;
}
export {};
//# sourceMappingURL=persistence-store.d.ts.map