import type { Router } from 'express';
import type { FederationStore, InMemoryFederationStore } from './federation-store.js';
import type { DbFederationStore } from './db-federation-store.js';
interface FederationRouteDeps {
    federationStore: FederationStore | InMemoryFederationStore | DbFederationStore;
    userStore: {
        findByIdpUser: (idpProvider: string, idpUserId: string, tenantId: string) => Promise<Record<string, unknown> | null>;
        createFromIdp: (data: {
            tenantId: string;
            username: string;
            email: string;
            displayName: string;
            idpProvider: string;
            idpUserId: string;
            roles: string[];
        }) => Promise<Record<string, unknown>>;
        updateIdpTokens: (userId: string, accessToken: string, refreshToken: string | undefined, expiresAt: number | undefined) => Promise<void>;
    };
    sessionStore: {
        create: (userId: string, ipAddress: string, userAgent: string, tenantId: string) => Promise<{
            token: string;
            expiresAt: string;
        }>;
    };
}
export declare function registerFederationRoutes(router: Router, deps: FederationRouteDeps): void;
export {};
//# sourceMappingURL=federation-routes.d.ts.map