'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchAuthSettings, updateAuthSettings, type AuthSettings } from '@/lib/auth-admin-api';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

export function SecuritySettingsPanel({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<AuthSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { settings: s } = await fetchAuthSettings();
      setSettings(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { settings: s } = await updateAuthSettings(settings);
      setSettings(s);
      setNotice('Settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <Card title="Authentication Settings" subtitle="Password policy, lockout policy, and session timeout">
        <p className="text-sm text-muted">{loading ? 'Loading…' : 'Unable to load settings'}</p>
      </Card>
    );
  }

  return (
    <Card
      title="Authentication Settings"
      subtitle="Password policy, lockout policy, and session timeout"
      actions={canManage ? <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button> : null}
    >
      {error && <div className="banner banner-danger" style={{ marginBottom: 12 }}><div className="banner-content">{error}</div></div>}
      {notice && <div className="banner banner-info" style={{ marginBottom: 12 }}><div className="banner-content">{notice}</div></div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h4 className="text-sm" style={{ marginBottom: 8 }}>Password policy</h4>
          <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Minimum length</label>
          <input
            className="input"
            type="number"
            min={8}
            max={128}
            disabled={!canManage}
            value={settings.passwordPolicy.minLength}
            onChange={(e) => setSettings({ ...settings, passwordPolicy: { ...settings.passwordPolicy, minLength: Number(e.target.value) } })}
            style={{ marginBottom: 10 }}
          />
          {([
            ['requireUppercase', 'Require uppercase letter'],
            ['requireLowercase', 'Require lowercase letter'],
            ['requireNumber', 'Require number'],
            ['requireSymbol', 'Require symbol'],
            ['disallowUsernameInPassword', 'Disallow username in password'],
          ] as const).map(([key, label]) => (
            <label key={key} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <input
                type="checkbox"
                disabled={!canManage}
                checked={settings.passwordPolicy[key]}
                onChange={(e) => setSettings({ ...settings, passwordPolicy: { ...settings.passwordPolicy, [key]: e.target.checked } })}
              />
              {label}
            </label>
          ))}
          <label className="text-xs text-muted" style={{ display: 'block', marginTop: 8, marginBottom: 4 }}>
            Password history (prevent reuse of last N passwords)
          </label>
          <input
            className="input"
            type="number"
            min={0}
            max={24}
            disabled={!canManage}
            value={settings.passwordPolicy.passwordHistoryCount}
            onChange={(e) => setSettings({ ...settings, passwordPolicy: { ...settings.passwordPolicy, passwordHistoryCount: Number(e.target.value) } })}
          />
        </div>

        <div>
          <h4 className="text-sm" style={{ marginBottom: 8 }}>Lockout policy</h4>
          <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Max failed attempts before lockout</label>
          <input
            className="input"
            type="number"
            min={1}
            max={50}
            disabled={!canManage}
            value={settings.lockoutPolicy.maxFailedAttempts}
            onChange={(e) => setSettings({ ...settings, lockoutPolicy: { ...settings.lockoutPolicy, maxFailedAttempts: Number(e.target.value) } })}
            style={{ marginBottom: 10 }}
          />
          <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Lockout duration (minutes)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={1440}
            disabled={!canManage}
            value={settings.lockoutPolicy.lockoutDurationMinutes}
            onChange={(e) => setSettings({ ...settings, lockoutPolicy: { ...settings.lockoutPolicy, lockoutDurationMinutes: Number(e.target.value) } })}
            style={{ marginBottom: 16 }}
          />

          <h4 className="text-sm" style={{ marginBottom: 8 }}>Session</h4>
          <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Idle timeout (minutes)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={43200}
            disabled={!canManage}
            value={settings.sessionTimeoutMinutes}
            onChange={(e) => setSettings({ ...settings, sessionTimeoutMinutes: Number(e.target.value) })}
          />
        </div>
      </div>
    </Card>
  );
}
