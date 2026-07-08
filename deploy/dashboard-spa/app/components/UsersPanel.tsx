'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  adminResetPassword,
  setUserStatus,
  forcePasswordChange,
  fetchRoles,
  fetchGroups,
  type AuthUser,
  type AuthRole,
  type AuthGroup,
  type UserStatus,
} from '@/lib/auth-admin-api';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

const STATUS_VARIANT: Record<UserStatus, 'success' | 'warning' | 'danger'> = {
  active: 'success',
  disabled: 'warning',
  locked: 'danger',
};

export function UsersPanel({ canManage }: { canManage: boolean }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [groups, setGroups] = useState<AuthGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r, g] = await Promise.all([fetchUsers(), fetchRoles(), fetchGroups()]);
      setUsers(u.users);
      setRoles(r.roles);
      setGroups(g.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const resetForm = () => {
    setEditingId(null);
    setUsername('');
    setEmail('');
    setDisplayName('');
    setSelectedRoleIds([]);
  };

  const startEdit = (u: AuthUser) => {
    setEditingId(u.id);
    setUsername(u.username);
    setEmail(u.email);
    setDisplayName(u.displayName);
    setSelectedRoleIds(u.roles.map((r) => r.id));
    setFormOpen(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      if (editingId) {
        await updateUser(editingId, { email, displayName, roleIds: selectedRoleIds });
        setNotice('User updated');
      } else {
        const result = await createUser({ username, email, displayName, roleIds: selectedRoleIds });
        setNotice(
          result.temporaryPassword
            ? `User created. Temporary password: ${result.temporaryPassword}`
            : 'User created',
        );
      }
      setFormOpen(false);
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const onDelete = async (u: AuthUser) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      await deleteUser(u.id);
      setNotice('User deleted');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const onResetPassword = async (u: AuthUser) => {
    try {
      const result = await adminResetPassword(u.id, { mustChangePassword: true });
      setNotice(
        result.temporaryPassword
          ? `Temporary password for ${u.username}: ${result.temporaryPassword}`
          : 'Password reset',
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    }
  };

  const onSetStatus = async (u: AuthUser, status: UserStatus) => {
    try {
      await setUserStatus(u.id, status);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status change failed');
    }
  };

  const onForceChange = async (u: AuthUser) => {
    try {
      await forcePasswordChange(u.id);
      setNotice(`${u.username} will be required to change their password at next login`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  void groups;

  return (
    <Card
      title="Users"
      subtitle="Manage dashboard accounts, roles, and account status"
      actions={
        canManage ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              resetForm();
              setFormOpen((v) => !v);
            }}
          >
            {formOpen ? 'Cancel' : 'New user'}
          </Button>
        ) : null
      }
    >
      {error && (
        <div className="banner banner-danger" style={{ marginBottom: 12 }}>
          <div className="banner-content">{error}</div>
        </div>
      )}
      {notice && (
        <div className="banner banner-info" style={{ marginBottom: 12 }}>
          <div className="banner-content">{notice}</div>
        </div>
      )}

      {formOpen && canManage && (
        <form onSubmit={(e) => void onSubmit(e)} style={{ marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Username</label>
              <input
                className="input"
                required
                disabled={!!editingId}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Display name</label>
              <input className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Email</label>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Roles</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {roles.map((r) => (
                  <label key={r.id} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={selectedRoleIds.includes(r.id)}
                      onChange={(e) =>
                        setSelectedRoleIds((prev) =>
                          e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id),
                        )
                      }
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          {!editingId && (
            <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
              A temporary password will be generated and shown once. The user must change it at first login.
            </p>
          )}
          <Button type="submit" variant="primary" size="sm">
            {editingId ? 'Save changes' : 'Create user'}
          </Button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading users…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted">No users found.</p>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>User</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Roles</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Last login</th>
                {canManage && <th style={{ textAlign: 'left', padding: '6px 8px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <div>{u.displayName}</div>
                    <div className="text-xs text-muted">@{u.username} · {u.email}</div>
                  </td>
                  <td style={{ padding: '6px 8px' }}>{u.roles.map((r) => r.name).join(', ') || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <Badge variant={STATUS_VARIANT[u.status]} dot>{u.status}</Badge>
                    {u.mustChangePassword && <span className="text-xs text-muted" style={{ marginLeft: 6 }}>must change pw</span>}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                  {canManage && (
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(u)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => void onResetPassword(u)}>Reset PW</Button>
                        <Button size="sm" variant="ghost" onClick={() => void onForceChange(u)}>Force PW change</Button>
                        {u.status === 'active' ? (
                          <Button size="sm" variant="ghost" onClick={() => void onSetStatus(u, 'disabled')}>Disable</Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => void onSetStatus(u, 'active')}>
                            {u.status === 'locked' ? 'Unlock' : 'Enable'}
                          </Button>
                        )}
                        <Button size="sm" variant="danger" onClick={() => void onDelete(u)}>Delete</Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
