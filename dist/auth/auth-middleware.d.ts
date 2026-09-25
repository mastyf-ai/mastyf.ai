/**
 * Express middleware for the DB-backed dashboard auth/RBAC system.
 *
 * Cookie strategy (OWASP session management cheat sheet):
 *  - `mastyf_ai_session` — httpOnly, Secure (in production), SameSite=Lax,
 *    holds the opaque session token. Never readable by JS.
 *  - `mastyf_ai_csrf`    — NOT httpOnly (JS must read it to echo it back
 *    as a header), Secure, SameSite=Lax. Paired 1:1 with the session via
 *    session.csrf_secret (double-submit cookie pattern).
 *
 * Mutating requests (POST/PUT/PATCH/DELETE) must present the CSRF cookie
 * value in the `X-CSRF-Token` header; the two are compared with a
 * timing-safe check server-side against the session's stored csrf_secret.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AuthUserWithAccess } from './rbac-types.js';
export declare const SESSION_COOKIE_NAME = "mastyf_ai_session";
export declare const CSRF_COOKIE_NAME = "mastyf_ai_csrf";
export declare const CSRF_HEADER_NAME = "x-csrf-token";
declare module 'express-serve-static-core' {
    interface Request {
        authUser?: AuthUserWithAccess;
        authSessionId?: string;
    }
}
export declare function parseCookies(header: string | undefined): Record<string, string>;
export declare function setSessionCookies(res: Response, token: string, csrfSecret: string, ttlMinutes: number): void;
export declare function clearSessionCookies(res: Response): void;
declare function clientIp(req: Request): string;
/**
 * Attaches `req.authUser` if a valid session cookie is present. Does NOT
 * reject unauthenticated requests — combine with `requireAuth` for that.
 * Always runs first so public routes (login, setup, status) can still
 * report "already authenticated" state.
 */
export declare function attachAuthContext(req: Request, _res: Response, next: NextFunction): Promise<void>;
/** Reject requests without a valid, CSRF-verified session. */
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
/** Reject requests whose user lacks the given permission key. */
export declare function requirePermission(permission: string): (req: Request, res: Response, next: NextFunction) => void;
export { clientIp };
export declare const AUTH_AUDIT_ACTIONS: {
    readonly LOGIN_SUCCESS: "auth.login.success";
    readonly LOGIN_FAILURE: "auth.login.failure";
    readonly LOGOUT: "auth.logout";
    readonly SETUP_COMPLETE: "auth.setup.complete";
    readonly PASSWORD_CHANGE: "auth.password.change";
    readonly PASSWORD_RESET_BY_ADMIN: "auth.password.reset_by_admin";
    readonly FORCE_PASSWORD_CHANGE: "auth.password.force_change_flag";
    readonly ACCOUNT_LOCKED: "auth.account.locked";
    readonly ACCOUNT_UNLOCKED: "auth.account.unlocked";
    readonly ACCOUNT_DISABLED: "auth.account.disabled";
    readonly ACCOUNT_ENABLED: "auth.account.enabled";
    readonly USER_CREATED: "user.created";
    readonly USER_UPDATED: "user.updated";
    readonly USER_DELETED: "user.deleted";
    readonly GROUP_CREATED: "group.created";
    readonly GROUP_UPDATED: "group.updated";
    readonly GROUP_DELETED: "group.deleted";
    readonly ROLE_CREATED: "role.created";
    readonly ROLE_UPDATED: "role.updated";
    readonly ROLE_DELETED: "role.deleted";
    readonly SESSION_REVOKED: "session.revoked";
    readonly SETTINGS_UPDATED: "settings.updated";
};
//# sourceMappingURL=auth-middleware.d.ts.map