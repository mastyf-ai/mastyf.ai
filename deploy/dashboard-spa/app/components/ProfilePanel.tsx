'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchCurrentUser,
  changeOwnPassword,
  fetchOwnSessions,
  revokeSession,
  fetchOwnLoginHistory,
  type AuthUser,
  type AuthSessionInfo,
  type AuditLogEntry,
} from '@/lib/auth-admin-api';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

export function ProfilePanel() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessions, setSessions] = useState<AuthSessionInfo[]>([]);
  const [history, setHistory] = useState<AuditLogEntry[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [me, s, h] = await Promise.all([fetchCurrentUser(), fetchOwnSessions(), fetchOwnLoginHistory()]);
    setUser(me?.user ?? null);
    setSessions(s.sessions);
    setHistory(h.entries);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      setNotice('Password changed. Your other sessions have been signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  const onRevoke = async (id: string) => {
    await revokeSession(id);
    await refresh();
  };

  if (!user) {
    return (
      <Card title="Profile">
        <p className="text-sm text-muted">Loading profile…</p>
      </Card>
    );
  }

  return (
    <div>
      <Card title="Profile" subtitle="Your account details">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, marginBottom: 4 }}>
          <div><strong>{user.displayName}</strong></div>
          <div className="text-sm text-muted">@{user.username} · {user.email}</div>
          <div className="text-sm text-muted">Roles: {user.roles.map((r) => r.name).join(', ') || '—'}</div>
          <div className="text-sm text-muted">
            Member since {new Date(user.createdAt).toLocaleDateString()}
            {user.lastLoginAt ? ` · Last login ${new Date(user.lastLoginAt).toLocaleString()}` : ''}
          </div>
        </div>
      </Card>

      <Card title="Change password">
        {error && <div className="banner banner-danger" style={{ marginBottom: 12 }}><div className="banner-content">{error}</div></div>}
        {notice && <div className="banner banner-info" style={{ marginBottom: 12 }}><div className="banner-content">{notice}</div></div>}
        <form onSubmit={(e) => void onChangePassword(e)} style={{ maxWidth: 360 }}>
          <div style={{ marginBottom: 10 }}>
            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Current password</label>
            <input className="input" type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>New password</label>
            <input className="input" type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Confirm new password</label>
            <input className="input" type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Change password'}</Button>
        </form>
      </Card>

      <Card title="Active sessions" subtitle="Devices currently signed in to your account">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted">No active sessions.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sessions.map((s) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="text-sm">
                  {s.ipAddress || 'Unknown IP'} {s.current && <Badge variant="info">This device</Badge>}
                  <div className="text-xs text-muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.userAgent || 'Unknown device'}
                  </div>
                  <div className="text-xs text-muted">
                    Last active {new Date(s.lastSeenAt).toLocaleString()} · Expires {new Date(s.expiresAt).toLocaleString()}
                  </div>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" onClick={() => void onRevoke(s.id)}>Sign out</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Login history" subtitle="Recent sign-in attempts on your account">
        {history.length === 0 ? (
          <p className="text-sm text-muted">No login history yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map((h) => (
              <div key={h.id} className="text-sm" style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
                <span>{new Date(h.createdAt).toLocaleString()} · {h.ipAddress || 'unknown IP'}</span>
                <Badge variant={h.result === 'success' ? 'success' : 'danger'} dot>{h.result}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
