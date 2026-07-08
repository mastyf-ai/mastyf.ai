'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchRoles,
  fetchPermissions,
  createRole,
  updateRole,
  deleteRole,
  type AuthRole,
  type AuthPermissionDef,
} from '@/lib/auth-admin-api';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

const TIERS: AuthRole['dashboardTier'][] = ['viewer', 'analyst', 'operator', 'admin', 'tenant-admin'];

export function RolesPanel({ canManage }: { canManage: boolean }) {
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [permissions, setPermissions] = useState<AuthPermissionDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<AuthRole['dashboardTier']>('viewer');
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([fetchRoles(), fetchPermissions()]);
      setRoles(r.roles);
      setPermissions(p.permissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setTier('viewer');
    setSelectedPerms([]);
  };

  const startEdit = (r: AuthRole) => {
    if (r.isSystem) return;
    setEditingId(r.id);
    setName(r.name);
    setDescription(r.description);
    setTier(r.dashboardTier);
    setSelectedPerms(r.permissions);
    setFormOpen(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      if (editingId) {
        await updateRole(editingId, { name, description, dashboardTier: tier, permissions: selectedPerms });
        setNotice('Role updated');
      } else {
        await createRole({ name, description, dashboardTier: tier, permissions: selectedPerms });
        setNotice('Role created');
      }
      setFormOpen(false);
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const onDelete = async (r: AuthRole) => {
    if (r.isSystem) return;
    if (!confirm(`Delete role "${r.name}"?`)) return;
    try {
      await deleteRole(r.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const categories = Array.from(new Set(permissions.map((p) => p.category)));

  return (
    <Card
      title="Roles"
      subtitle="Custom roles are collections of permissions; system roles are built-in and cannot be modified"
      actions={
        canManage ? (
          <Button size="sm" variant="primary" onClick={() => { resetForm(); setFormOpen((v) => !v); }}>
            {formOpen ? 'Cancel' : 'New role'}
          </Button>
        ) : null
      }
    >
      {error && <div className="banner banner-danger" style={{ marginBottom: 12 }}><div className="banner-content">{error}</div></div>}
      {notice && <div className="banner banner-info" style={{ marginBottom: 12 }}><div className="banner-content">{notice}</div></div>}

      {formOpen && canManage && (
        <form onSubmit={(e) => void onSubmit(e)} style={{ marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Name</label>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Dashboard tier</label>
              <select className="input" value={tier} onChange={(e) => setTier(e.target.value as AuthRole['dashboardTier'])}>
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Description</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {categories.map((cat) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div className="text-xs text-muted" style={{ marginBottom: 4, textTransform: 'capitalize' }}>{cat}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {permissions.filter((p) => p.category === cat).map((p) => (
                  <label key={p.key} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={p.description}>
                    <input
                      type="checkbox"
                      checked={selectedPerms.includes(p.key)}
                      onChange={(e) =>
                        setSelectedPerms((prev) => (e.target.checked ? [...prev, p.key] : prev.filter((k) => k !== p.key)))
                      }
                    />
                    {p.key}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <Button type="submit" variant="primary" size="sm">{editingId ? 'Save changes' : 'Create role'}</Button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading roles…</p>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Tier</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Permissions</th>
                {canManage && <th style={{ textAlign: 'left', padding: '6px 8px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    {r.name} {r.isSystem && <Badge variant="neutral">system</Badge>}
                    <div className="text-xs text-muted">{r.description}</div>
                  </td>
                  <td style={{ padding: '6px 8px' }}>{r.dashboardTier}</td>
                  <td style={{ padding: '6px 8px', maxWidth: 320 }} className="text-xs text-muted">
                    {r.permissions.length} permission{r.permissions.length === 1 ? '' : 's'}
                  </td>
                  {canManage && (
                    <td style={{ padding: '6px 8px' }}>
                      {!r.isSystem && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>Edit</Button>
                          <Button size="sm" variant="danger" onClick={() => void onDelete(r)}>Delete</Button>
                        </div>
                      )}
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
