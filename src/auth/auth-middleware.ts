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
import { timingSafeEqual } from 'crypto';
import { sessionStore } from './session-store.js';
import { userStore } from './user-store.js';
import { resolveUserAccess } from './rbac-engine.js';
import { auditLog } from './audit-log.js';
import { AUDIT_ACTIONS } from './rbac-types.js';
import type { AuthUserWithAccess } from './rbac-types.js';

export const SESSION_COOKIE_NAME = 'mastyf_ai_session';
export const CSRF_COOKIE_NAME = 'mastyf_ai_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: AuthUserWithAccess;
    authSessionId?: string;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function setSessionCookies(res: Response, token: string, csrfSecret: string, ttlMinutes: number): void {
  const maxAge = ttlMinutes * 60_000;
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  res.cookie(CSRF_COOKIE_NAME, csrfSecret, {
    httpOnly: false,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Attaches `req.authUser` if a valid session cookie is present. Does NOT
 * reject unauthenticated requests — combine with `requireAuth` for that.
 * Always runs first so public routes (login, setup, status) can still
 * report "already authenticated" state.
 */
export async function attachAuthContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return next();

    const session = await sessionStore.validate(token);
    if (!session) return next();

    // CSRF check for mutating requests, done here so every protected route
    // benefits without repeating the check.
    if (!SAFE_METHODS.has(req.method.toUpperCase())) {
      const headerToken = req.header(CSRF_HEADER_NAME);
      if (!headerToken || !timingSafeEqualStr(headerToken, session.csrfSecret)) {
        return next(); // leave req.authUser unset -> requireAuth will 401/403 appropriately below
      }
    }

    const user = await userStore.findById(session.userId);
    if (!user || user.status !== 'active') return next();

    req.authUser = await resolveUserAccess(user);
    req.authSessionId = session.id;
    next();
  } catch (err) {
    next(err as Error);
  }
}

/** Reject requests without a valid, CSRF-verified session. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

/** Reject requests whose user lacks the given permission key. */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!req.authUser.permissions.includes(permission)) {
      void auditLog.write({
        tenantId: req.authUser.tenantId,
        userId: req.authUser.id,
        username: req.authUser.username,
        action: 'authz.denied',
        result: 'failure',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { permission, path: req.originalUrl, method: req.method },
      });
      res.status(403).json({ error: 'Forbidden', requiredPermission: permission });
      return;
    }
    next();
  };
}

export { clientIp };
export const AUTH_AUDIT_ACTIONS = AUDIT_ACTIONS;
