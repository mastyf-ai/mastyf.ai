/**
 * Registers every route for the auth/RBAC subsystem onto an existing
 * Express app: initial setup, login/logout/me/change-password, user
 * management, groups, roles, permissions, sessions, audit log, and
 * admin-configurable settings.
 *
 * Call `registerAuthRoutes(app)` once during server bootstrap, before
 * the generic protected-route gate is applied (see soc-api-server.ts).
 */
import type { Express } from 'express';
export declare function registerAuthRoutes(app: Express): void;
//# sourceMappingURL=auth-routes.d.ts.map