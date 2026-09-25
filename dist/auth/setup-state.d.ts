export declare const setupState: {
    /**
     * Setup is considered complete once either:
     *  (a) the auth_setup_state row is marked completed, or
     *  (b) at least one user already exists (defensive — covers upgrades
     *      from an environment where users were provisioned out-of-band).
     * Once true, POST /api/auth/setup permanently 403s.
     */
    isComplete(tenantId?: string): Promise<boolean>;
    markComplete(tenantId?: string): Promise<void>;
};
//# sourceMappingURL=setup-state.d.ts.map