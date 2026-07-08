/**
 * Registers every route for the auth/RBAC subsystem onto an existing
 * Express app: initial setup, login/logout/me/change-password, user
 * management, groups, roles, permissions, sessions, audit log, and
 * admin-configurable settings.
 *
 * Call `registerAuthRoutes(app)` once during server bootstrap, before
 * the generic protected-route gate is applied (see soc-api-server.ts).
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { userStore } from './user-store.js';
import { roleStore, permissionCatalog } from './role-store.js';
import { groupStore } from './group-store.js';
import { sessionStore } from './session-store.js';
import { auditLog } from './audit-log.js';
import { authSettingsStore } from './auth-settings-store.js';
import { setupState } from './setup-state.js';
import { resolveUserAccess } from './rbac-engine.js';
import { hashPassword, verifyPassword, validatePasswordAgainstPolicy } from './password.js';
import {
  requireAuth,
  requirePermission,
  setSessionCookies,
  clearSessionCookies,
  parseCookies,
  clientIp,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from './auth-middleware.js';
import { AUDIT_ACTIONS } from './rbac-types.js';
import { Logger } from '../utils/logger.js';

const DEFAULT_TENANT = 'default';

function getTenantId(req: Request): string {
  return (req.header('x-mastyf-ai-tenant') || req.header('x-tenant-id') || DEFAULT_TENANT).trim() || DEFAULT_TENANT;
}

function handleError(res: Response, err: unknown): void {
  const statusCode = (err as { statusCode?: number })?.statusCode ?? 500;
  const message = err instanceof Error ? err.message : 'Internal error';
  if (statusCode >= 500) Logger.error(`[auth-routes] ${message}`);
  res.status(statusCode).json({ error: message });
}

// ── Validation schemas ────────────────────────────────────────────────────

const usernameSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores, and hyphens');
const emailSchema = z.string().email().max(254);

const setupSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  displayName: z.string().min(1).max(128),
  password: z.string().min(8).max(256),
});

const loginSchema = z.object({
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(256),
});

const createUserSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  displayName: z.string().min(1).max(128),
  password: z.string().min(8).max(256).optional(),
  status: z.enum(['active', 'disabled', 'locked']).optional(),
  mustChangePassword: z.boolean().optional(),
  roleIds: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional(),
});

const updateUserSchema = z.object({
  email: emailSchema.optional(),
  displayName: z.string().min(1).max(128).optional(),
  status: z.enum(['active', 'disabled', 'locked']).optional(),
  roleIds: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(256),
});

const adminResetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(256).optional(),
  mustChangePassword: z.boolean().optional(),
});

const roleSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  dashboardTier: z.enum(['viewer', 'analyst', 'operator', 'admin', 'tenant-admin']),
  permissions: z.array(z.string()),
});

const groupSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  roleIds: z.array(z.string()).optional(),
  memberIds: z.array(z.string()).optional(),
});

const settingsSchema = z.object({
  passwordPolicy: z
    .object({
      minLength: z.number().int().min(8).max(128).optional(),
      requireUppercase: z.boolean().optional(),
      requireLowercase: z.boolean().optional(),
      requireNumber: z.boolean().optional(),
      requireSymbol: z.boolean().optional(),
      disallowUsernameInPassword: z.boolean().optional(),
      passwordHistoryCount: z.number().int().min(0).max(24).optional(),
      maxAgeDays: z.number().int().min(0).max(3650).optional(),
    })
    .optional(),
  lockoutPolicy: z
    .object({
      maxFailedAttempts: z.number().int().min(1).max(50).optional(),
      lockoutDurationMinutes: z.number().int().min(1).max(1440).optional(),
    })
    .optional(),
  sessionTimeoutMinutes: z.number().int().min(1).max(43200).optional(),
  sessionAbsoluteTimeoutMinutes: z.number().int().min(1).max(525600).optional(),
  requireMfaForAdmins: z.boolean().optional(),
  allowSelfRegistration: z.boolean().optional(),
});

export function registerAuthRoutes(app: Express): void {
  // ── Setup ──────────────────────────────────────────────────────────────

  app.get('/api/auth/setup/status', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const complete = await setupState.isComplete(tenantId);
    res.json({ setupRequired: !complete });
  });

  app.post('/api/auth/setup', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    try {
      if (await setupState.isComplete(tenantId)) {
        res.status(403).json({ error: 'Setup has already been completed and is permanently disabled' });
        return;
      }
      const parsed = setupSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }
      const settings = await authSettingsStore.get(tenantId);
      const validation = validatePasswordAgainstPolicy(parsed.data.password, settings.passwordPolicy, {
        username: parsed.data.username,
        email: parsed.data.email,
      });
      if (!validation.valid) {
        res.status(400).json({ error: 'Password does not meet policy', details: validation.errors });
        return;
      }

      const { roleStore: rs } = await import('./role-store.js');
      await rs.ensureSeeded(tenantId);
      const adminRole = await rs.findByDashboardTier('admin', tenantId);

      const user = await userStore.create({
        tenantId,
        username: parsed.data.username,
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        password: parsed.data.password,
        status: 'active',
        mustChangePassword: false,
      });
      if (adminRole) await roleStore.assignToUser(user.id, adminRole.id, user.id);
      await setupState.markComplete(tenantId);

      await auditLog.write({
        tenantId,
        userId: user.id,
        username: user.username,
        action: AUDIT_ACTIONS.SETUP_COMPLETE,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
      });

      res.status(201).json({ success: true, userId: user.id });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Auth status / CSRF (replaces open-core stubs) ────────────────────────

  app.get('/api/auth/status', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const setupRequired = !(await setupState.isComplete(tenantId));
    if (req.authUser) {
      res.json({
        authenticated: true,
        authRequired: true,
        authConfigured: true,
        setupRequired,
        identity: req.authUser.username,
        roles: req.authUser.dashboardRoles,
        permissions: req.authUser.permissions,
        sessionTenantId: req.authUser.tenantId,
        openCore: false,
      });
      return;
    }
    res.json({
      authenticated: false,
      authRequired: true,
      authConfigured: true,
      setupRequired,
      openCore: false,
    });
  });

  app.get('/api/auth/csrf', async (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies[CSRF_COOKIE_NAME];
    res.json({ csrfEnforced: true, csrfToken });
  });

  // ── Login / logout / me ──────────────────────────────────────────────────

  async function loginHandler(req: Request, res: Response): Promise<void> {
    const tenantId = getTenantId(req);
    const ip = clientIp(req);
    const userAgent = req.header('user-agent') || null;
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Username and password are required' });
        return;
      }
      const { username, password } = parsed.data;
      const settings = await authSettingsStore.get(tenantId);
      const userWithHash = await userStore.findByUsernameOrEmailWithHash(username, tenantId);

      // Constant-shape response whether the user exists or not, to avoid
      // username enumeration; verify against a dummy hash if not found.
      const DUMMY_HASH =
        '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const passwordOk = await verifyPassword(userWithHash?.passwordHash ?? DUMMY_HASH, password);

      if (!userWithHash || !passwordOk) {
        if (userWithHash) {
          const { locked } = await userStore.recordFailedLogin(
            userWithHash.id,
            settings.lockoutPolicy.maxFailedAttempts,
            settings.lockoutPolicy.lockoutDurationMinutes,
          );
          await auditLog.write({
            tenantId,
            userId: userWithHash.id,
            username: userWithHash.username,
            action: locked ? AUDIT_ACTIONS.ACCOUNT_LOCKED : AUDIT_ACTIONS.LOGIN_FAILURE,
            result: 'failure',
            ipAddress: ip,
            userAgent,
          });
        } else {
          await auditLog.write({
            tenantId,
            username,
            action: AUDIT_ACTIONS.LOGIN_FAILURE,
            result: 'failure',
            ipAddress: ip,
            userAgent,
            metadata: { reason: 'unknown_user' },
          });
        }
        res.status(401).json({ success: false, error: 'Invalid username or password' });
        return;
      }

      if (userWithHash.status === 'locked' && !userStore.isLockExpired(userWithHash)) {
        await auditLog.write({
          tenantId,
          userId: userWithHash.id,
          username: userWithHash.username,
          action: AUDIT_ACTIONS.LOGIN_FAILURE,
          result: 'failure',
          ipAddress: ip,
          userAgent,
          metadata: { reason: 'account_locked' },
        });
        res.status(423).json({ success: false, error: 'Account is locked. Try again later or contact an administrator.' });
        return;
      }
      if (userWithHash.status === 'disabled') {
        await auditLog.write({
          tenantId,
          userId: userWithHash.id,
          username: userWithHash.username,
          action: AUDIT_ACTIONS.LOGIN_FAILURE,
          result: 'failure',
          ipAddress: ip,
          userAgent,
          metadata: { reason: 'account_disabled' },
        });
        res.status(403).json({ success: false, error: 'This account has been disabled.' });
        return;
      }
      if (userWithHash.status === 'locked') {
        await userStore.unlock(userWithHash.id); // lock window elapsed
      }

      const session = await sessionStore.create({
        userId: userWithHash.id,
        tenantId,
        ipAddress: ip,
        userAgent,
        ttlMinutes: settings.sessionTimeoutMinutes,
      });
      setSessionCookies(res, session.token, session.csrfSecret, settings.sessionTimeoutMinutes);
      await userStore.recordSuccessfulLogin(userWithHash.id, ip);
      await auditLog.write({
        tenantId,
        userId: userWithHash.id,
        username: userWithHash.username,
        action: AUDIT_ACTIONS.LOGIN_SUCCESS,
        result: 'success',
        ipAddress: ip,
        userAgent,
      });

      res.json({
        success: true,
        mustChangePassword: userWithHash.mustChangePassword,
      });
    } catch (err) {
      handleError(res, err);
    }
  }

  app.post('/api/auth/login', loginHandler);
  // Back-compat alias — the SPA's existing loginDashboard() calls /api/login.
  app.post('/api/login', loginHandler);

  async function logoutHandler(req: Request, res: Response): Promise<void> {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE_NAME];
      if (token) await sessionStore.revokeByToken(token);
      if (req.authUser) {
        await auditLog.write({
          tenantId: req.authUser.tenantId,
          userId: req.authUser.id,
          username: req.authUser.username,
          action: AUDIT_ACTIONS.LOGOUT,
          result: 'success',
          ipAddress: clientIp(req),
          userAgent: req.header('user-agent') || null,
        });
      }
      clearSessionCookies(res);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  }

  app.post('/api/auth/logout', logoutHandler);
  app.post('/api/logout', logoutHandler);

  app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.authUser });
  });

  app.post('/api/auth/change-password', requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }
      const user = req.authUser!;
      const withHash = await userStore.findByUsernameOrEmailWithHash(user.username, user.tenantId);
      if (!withHash || !(await verifyPassword(withHash.passwordHash, parsed.data.currentPassword))) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }
      const settings = await authSettingsStore.get(user.tenantId);
      const validation = validatePasswordAgainstPolicy(parsed.data.newPassword, settings.passwordPolicy, {
        username: user.username,
        email: user.email,
      });
      if (!validation.valid) {
        res.status(400).json({ error: 'Password does not meet policy', details: validation.errors });
        return;
      }
      await userStore.setPassword(user.id, parsed.data.newPassword, false);
      await sessionStore.revokeAllForUser(user.id, req.authSessionId);
      await auditLog.write({
        tenantId: user.tenantId,
        userId: user.id,
        username: user.username,
        action: AUDIT_ACTIONS.PASSWORD_CHANGE,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
      });
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Own sessions & login history ─────────────────────────────────────────

  app.get('/api/auth/sessions', requireAuth, async (req: Request, res: Response) => {
    const sessions = await sessionStore.listForUser(req.authUser!.id, req.authSessionId);
    res.json({ sessions });
  });

  app.delete('/api/auth/sessions/:id', requireAuth, async (req: Request, res: Response) => {
    const session = await sessionStore.findById(req.params.id);
    const isOwn = session && session.userId === req.authUser!.id;
    const canRevokeAny = req.authUser!.permissions.includes('sessions.revoke');
    if (!session || (!isOwn && !canRevokeAny)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await sessionStore.revoke(session.id);
    await auditLog.write({
      tenantId: req.authUser!.tenantId,
      userId: req.authUser!.id,
      username: req.authUser!.username,
      action: AUDIT_ACTIONS.SESSION_REVOKED,
      result: 'success',
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') || null,
      metadata: { revokedSessionId: session.id, ownSession: isOwn },
    });
    res.json({ success: true });
  });

  app.get('/api/auth/login-history', requireAuth, async (req: Request, res: Response) => {
    const { entries, total } = await auditLog.query({
      tenantId: req.authUser!.tenantId,
      userId: req.authUser!.id,
      limit: 50,
    });
    const loginEvents = entries.filter((e) => e.action === AUDIT_ACTIONS.LOGIN_SUCCESS || e.action === AUDIT_ACTIONS.LOGIN_FAILURE);
    res.json({ entries: loginEvents, total });
  });

  // ── User management ───────────────────────────────────────────────────

  app.get('/api/users', requireAuth, requirePermission('users.read'), async (req: Request, res: Response) => {
    const users = await userStore.list(req.authUser!.tenantId);
    const withAccess = await Promise.all(users.map((u) => resolveUserAccess(u)));
    res.json({ users: withAccess });
  });

  app.get('/api/users/:id', requireAuth, requirePermission('users.read'), async (req: Request, res: Response) => {
    const user = await userStore.findById(req.params.id, req.authUser!.tenantId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user: await resolveUserAccess(user) });
  });

  app.post('/api/users', requireAuth, requirePermission('users.manage'), async (req: Request, res: Response) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }
      const tenantId = req.authUser!.tenantId;
      const settings = await authSettingsStore.get(tenantId);
      const { generateRandomPassword } = await import('./password.js');
      const password = parsed.data.password ?? generateRandomPassword();
      if (parsed.data.password) {
        const validation = validatePasswordAgainstPolicy(password, settings.passwordPolicy, {
          username: parsed.data.username,
          email: parsed.data.email,
        });
        if (!validation.valid) {
          res.status(400).json({ error: 'Password does not meet policy', details: validation.errors });
          return;
        }
      }
      const existing = await userStore.findByUsernameOrEmail(parsed.data.username, tenantId);
      if (existing) {
        res.status(409).json({ error: 'Username or email already in use' });
        return;
      }
      const user = await userStore.create({
        tenantId,
        username: parsed.data.username,
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        password,
        status: parsed.data.status ?? 'active',
        mustChangePassword: parsed.data.mustChangePassword ?? !parsed.data.password,
        createdBy: req.authUser!.id,
      });
      if (parsed.data.roleIds?.length) await roleStore.setUserRoles(user.id, parsed.data.roleIds, req.authUser!.id);
      if (parsed.data.groupIds?.length) {
        for (const groupId of parsed.data.groupIds) await groupStore.addMember(groupId, user.id, req.authUser!.id);
      }
      await auditLog.write({
        tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: AUDIT_ACTIONS.USER_CREATED,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { createdUserId: user.id, createdUsername: user.username },
      });
      res.status(201).json({
        user: await resolveUserAccess(user),
        temporaryPassword: parsed.data.password ? undefined : password,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put('/api/users/:id', requireAuth, requirePermission('users.manage'), async (req: Request, res: Response) => {
    try {
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }
      const tenantId = req.authUser!.tenantId;
      const user = await userStore.update(req.params.id, parsed.data, tenantId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (parsed.data.roleIds) await roleStore.setUserRoles(user.id, parsed.data.roleIds, req.authUser!.id);
      if (parsed.data.groupIds) await groupStore.setGroupsForUser(user.id, parsed.data.groupIds, req.authUser!.id);
      await auditLog.write({
        tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: AUDIT_ACTIONS.USER_UPDATED,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { targetUserId: user.id },
      });
      res.json({ user: await resolveUserAccess(user) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete('/api/users/:id', requireAuth, requirePermission('users.manage'), async (req: Request, res: Response) => {
    if (req.params.id === req.authUser!.id) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }
    const deleted = await userStore.delete(req.params.id, req.authUser!.tenantId);
    if (!deleted) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    await sessionStore.revokeAllForUser(req.params.id);
    await auditLog.write({
      tenantId: req.authUser!.tenantId,
      userId: req.authUser!.id,
      username: req.authUser!.username,
      action: AUDIT_ACTIONS.USER_DELETED,
      result: 'success',
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') || null,
      metadata: { targetUserId: req.params.id },
    });
    res.json({ success: true });
  });

  app.post(
    '/api/users/:id/reset-password',
    requireAuth,
    requirePermission('users.manage'),
    async (req: Request, res: Response) => {
      try {
        const parsed = adminResetPasswordSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid input' });
          return;
        }
        const user = await userStore.findById(req.params.id, req.authUser!.tenantId);
        if (!user) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        const { generateRandomPassword } = await import('./password.js');
        const newPassword = parsed.data.newPassword ?? generateRandomPassword();
        if (parsed.data.newPassword) {
          const settings = await authSettingsStore.get(req.authUser!.tenantId);
          const validation = validatePasswordAgainstPolicy(newPassword, settings.passwordPolicy, {
            username: user.username,
            email: user.email,
          });
          if (!validation.valid) {
            res.status(400).json({ error: 'Password does not meet policy', details: validation.errors });
            return;
          }
        }
        await userStore.setPassword(user.id, newPassword, parsed.data.mustChangePassword ?? true);
        await sessionStore.revokeAllForUser(user.id);
        await auditLog.write({
          tenantId: req.authUser!.tenantId,
          userId: req.authUser!.id,
          username: req.authUser!.username,
          action: AUDIT_ACTIONS.PASSWORD_RESET_BY_ADMIN,
          result: 'success',
          ipAddress: clientIp(req),
          userAgent: req.header('user-agent') || null,
          metadata: { targetUserId: user.id },
        });
        res.json({ success: true, temporaryPassword: parsed.data.newPassword ? undefined : newPassword });
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  app.post(
    '/api/users/:id/status',
    requireAuth,
    requirePermission('users.manage'),
    async (req: Request, res: Response) => {
      const status = z.enum(['active', 'disabled', 'locked']).safeParse(req.body?.status);
      if (!status.success) {
        res.status(400).json({ error: 'status must be one of active, disabled, locked' });
        return;
      }
      const user = await userStore.findById(req.params.id, req.authUser!.tenantId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (status.data === 'active' && user.status === 'locked') {
        await userStore.unlock(user.id);
      } else {
        await userStore.setStatus(user.id, status.data);
      }
      if (status.data !== 'active') await sessionStore.revokeAllForUser(user.id);
      const actionMap = {
        active: AUDIT_ACTIONS.ACCOUNT_ENABLED,
        disabled: AUDIT_ACTIONS.ACCOUNT_DISABLED,
        locked: AUDIT_ACTIONS.ACCOUNT_LOCKED,
      } as const;
      await auditLog.write({
        tenantId: req.authUser!.tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: actionMap[status.data],
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { targetUserId: user.id },
      });
      res.json({ success: true });
    },
  );

  app.post(
    '/api/users/:id/force-password-change',
    requireAuth,
    requirePermission('users.manage'),
    async (req: Request, res: Response) => {
      const user = await userStore.findById(req.params.id, req.authUser!.tenantId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      await userStore.setMustChangePassword(user.id, true);
      await auditLog.write({
        tenantId: req.authUser!.tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: AUDIT_ACTIONS.FORCE_PASSWORD_CHANGE,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { targetUserId: user.id },
      });
      res.json({ success: true });
    },
  );

  // ── Groups ────────────────────────────────────────────────────────────

  app.get('/api/groups', requireAuth, requirePermission('groups.read'), async (req: Request, res: Response) => {
    res.json({ groups: await groupStore.list(req.authUser!.tenantId) });
  });

  app.post('/api/groups', requireAuth, requirePermission('groups.manage'), async (req: Request, res: Response) => {
    try {
      const parsed = groupSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }
      const group = await groupStore.create({ tenantId: req.authUser!.tenantId, ...parsed.data });
      if (parsed.data.memberIds?.length) await groupStore.setMembers(group.id, parsed.data.memberIds, req.authUser!.id);
      await auditLog.write({
        tenantId: req.authUser!.tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: AUDIT_ACTIONS.GROUP_CREATED,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { groupId: group.id },
      });
      res.status(201).json({ group });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put('/api/groups/:id', requireAuth, requirePermission('groups.manage'), async (req: Request, res: Response) => {
    try {
      const parsed = groupSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }
      const group = await groupStore.update(req.params.id, parsed.data, req.authUser!.tenantId);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }
      if (parsed.data.memberIds) await groupStore.setMembers(group.id, parsed.data.memberIds, req.authUser!.id);
      await auditLog.write({
        tenantId: req.authUser!.tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: AUDIT_ACTIONS.GROUP_UPDATED,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { groupId: group.id },
      });
      res.json({ group });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete('/api/groups/:id', requireAuth, requirePermission('groups.manage'), async (req: Request, res: Response) => {
    const deleted = await groupStore.delete(req.params.id, req.authUser!.tenantId);
    if (!deleted) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    await auditLog.write({
      tenantId: req.authUser!.tenantId,
      userId: req.authUser!.id,
      username: req.authUser!.username,
      action: AUDIT_ACTIONS.GROUP_DELETED,
      result: 'success',
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent') || null,
      metadata: { groupId: req.params.id },
    });
    res.json({ success: true });
  });

  // ── Roles & permissions ───────────────────────────────────────────────

  app.get('/api/permissions', requireAuth, requirePermission('roles.read'), async (_req: Request, res: Response) => {
    res.json({ permissions: await permissionCatalog.list() });
  });

  app.get('/api/roles', requireAuth, requirePermission('roles.read'), async (req: Request, res: Response) => {
    res.json({ roles: await roleStore.list(req.authUser!.tenantId) });
  });

  app.post('/api/roles', requireAuth, requirePermission('roles.manage'), async (req: Request, res: Response) => {
    try {
      const parsed = roleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }
      const role = await roleStore.create({ tenantId: req.authUser!.tenantId, ...parsed.data });
      await auditLog.write({
        tenantId: req.authUser!.tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: AUDIT_ACTIONS.ROLE_CREATED,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { roleId: role.id },
      });
      res.status(201).json({ role });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put('/api/roles/:id', requireAuth, requirePermission('roles.manage'), async (req: Request, res: Response) => {
    try {
      const parsed = roleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }
      const role = await roleStore.update(req.params.id, parsed.data, req.authUser!.tenantId);
      if (!role) {
        res.status(404).json({ error: 'Role not found' });
        return;
      }
      await auditLog.write({
        tenantId: req.authUser!.tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: AUDIT_ACTIONS.ROLE_UPDATED,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { roleId: role.id },
      });
      res.json({ role });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete('/api/roles/:id', requireAuth, requirePermission('roles.manage'), async (req: Request, res: Response) => {
    try {
      const deleted = await roleStore.delete(req.params.id, req.authUser!.tenantId);
      if (!deleted) {
        res.status(404).json({ error: 'Role not found' });
        return;
      }
      await auditLog.write({
        tenantId: req.authUser!.tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: AUDIT_ACTIONS.ROLE_DELETED,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
        metadata: { roleId: req.params.id },
      });
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Audit log ─────────────────────────────────────────────────────────

  app.get('/api/audit-logs', requireAuth, requirePermission('audit.read'), async (req: Request, res: Response) => {
    const { entries, total } = await auditLog.query({
      tenantId: req.authUser!.tenantId,
      userId: typeof req.query['userId'] === 'string' ? req.query['userId'] : undefined,
      action: typeof req.query['action'] === 'string' ? req.query['action'] : undefined,
      result: req.query['result'] === 'success' || req.query['result'] === 'failure' ? req.query['result'] : undefined,
      since: typeof req.query['since'] === 'string' ? req.query['since'] : undefined,
      until: typeof req.query['until'] === 'string' ? req.query['until'] : undefined,
      limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
      offset: req.query['offset'] ? Number(req.query['offset']) : undefined,
    });
    res.json({ entries, total });
  });

  // ── Settings ──────────────────────────────────────────────────────────

  app.get('/api/settings/auth', requireAuth, requirePermission('settings.read'), async (req: Request, res: Response) => {
    res.json({ settings: await authSettingsStore.get(req.authUser!.tenantId) });
  });

  app.put(
    '/api/settings/auth',
    requireAuth,
    requirePermission('settings.manage'),
    async (req: Request, res: Response) => {
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }
      const settings = await authSettingsStore.update(req.authUser!.tenantId, parsed.data, req.authUser!.id);
      await auditLog.write({
        tenantId: req.authUser!.tenantId,
        userId: req.authUser!.id,
        username: req.authUser!.username,
        action: AUDIT_ACTIONS.SETTINGS_UPDATED,
        result: 'success',
        ipAddress: clientIp(req),
        userAgent: req.header('user-agent') || null,
      });
      res.json({ settings });
    },
  );

  // ── CSRF header name re-export for consumers that need it dynamically ──
  void CSRF_HEADER_NAME;
}
