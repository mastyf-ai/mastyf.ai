'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  fetchRoles,
  fetchUsers,
  type AuthGroup,
  type AuthRole,
  type AuthUser,
} from '@/lib/auth-admin-api';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

export function GroupsPanel({ canManage }: { canManage: boolean }) {
  const [groups, setGroups] = useState<AuthGroup[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [g, r, u] = await Promise.all([fetchGroups(), fetchRoles(), fetchUsers()]);
      setGroups(g.groups);
      setRoles(r.roles);
      setUsers(u.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setSelectedRoleIds([]);
    setSelectedMemberIds([]);
  };

  const startEdit = (g: AuthGroup) => {
    setEditingId(g.id);
    setName(g.name);
    setDescription(g.description);
    setSelectedRoleIds(g.roleIds);
    setSelectedMemberIds(users.filter((u) => u.groups.some((ug) => ug.id === g.id)).map((u) => u.id));
    setFormOpen(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      if (editingId) {
        await updateGroup(editingId, { name, description, roleIds: selectedRoleIds, memberIds: selectedMemberIds });
        setNotice('Group updated');
      } else {
        await createGroup({ name, description, roleIds: selectedRoleIds, memberIds: selectedMemberIds });
        setNotice('Group created');
      }
      setFormOpen(false);
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const onDelete = async (g: AuthGroup) => {
    if (!confirm(`Delete group "${g.name}"?`)) return;
    try {
      await deleteGroup(g.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <Card
      title="Groups"
      subtitle="Organize users and assign roles at the group level"
      actions={
        canManage ? (
          <Button size="sm" variant="primary" onClick={() => { resetForm(); setFormOpen((v) => !v); }}>
            {formOpen ? 'Cancel' : 'New group'}
          </Button>
        ) : null
      }
    >
      {error && <div className="banner banner-danger" style={{ marginBottom: 12 }}><div className="banner-content">{error}</div></div>}
      {notice && <div className="banner banner-info" style={{ marginBottom: 12 }}><div className="banner-content">{notice}</div></div>}

      {formOpen && canManage && (
        <form onSubmit={(e) => void onSubmit(e)} style={{ marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ marginBottom: 12 }}>
            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Name</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Description</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Roles granted to this group</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {roles.map((r) => (
                <label key={r.id} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={selectedRoleIds.includes(r.id)}
                    onChange={(e) =>
                      setSelectedRoleIds((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)))
                    }
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Members</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 120, overflow: 'auto' }}>
              {users.map((u) => (
                <label key={u.id} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.includes(u.id)}
                    onChange={(e) =>
                      setSelectedMemberIds((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                    }
                  />
                  {u.username}
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" variant="primary" size="sm">{editingId ? 'Save changes' : 'Create group'}</Button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading groups…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted">No groups defined yet.</p>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Group</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Roles</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Members</th>
                {canManage && <th style={{ textAlign: 'left', padding: '6px 8px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <div>{g.name}</div>
                    <div className="text-xs text-muted">{g.description}</div>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {roles.filter((r) => g.roleIds.includes(r.id)).map((r) => r.name).join(', ') || '—'}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{g.memberCount}</td>
                  {canManage && (
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(g)}>Edit</Button>
                        <Button size="sm" variant="danger" onClick={() => void onDelete(g)}>Delete</Button>
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
