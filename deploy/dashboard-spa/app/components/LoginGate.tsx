'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  fetchAuthStatus,
  fetchCsrfToken,
  getTenantId,
  loginDashboard,
  logoutDashboard,
  setTenantId,
  type AuthStatus,
} from '@/lib/guardian-api';

type Props = {
  children: ReactNode;
  onAuthenticated?: () => void;
};

export function LoginGate({ children, onAuthenticated }: Props) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [tenant, setTenant] = useState('default');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await fetchAuthStatus();
    setStatus(s);
    setTenant(getTenantId());
    setLoading(false);
    return s;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canShowDashboard =
    status && (!status.authRequired || status.authenticated || !status.authConfigured);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    setTenantId(tenant);
    const csrf = await fetchCsrfToken();
    const result = await loginDashboard({
      username: username || undefined,
      password: password || undefined,
      api_key: apiKey || undefined,
      csrfToken: csrf.csrfToken,
    });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Login failed');
      return;
    }
    await refresh();
    onAuthenticated?.();
  };

  const onLogout = async () => {
    await logoutDashboard();
    setUsername('');
    setPassword('');
    setApiKey('');
    await refresh();
  };

  if (loading) {
    return <p className="muted">Checking session…</p>;
  }

  if (!canShowDashboard) {
    return (
      <section className="login-panel" aria-label="Dashboard login">
        <h2>Sign in</h2>
        <p className="hint">Dashboard API requires authentication.</p>
        <form onSubmit={(e) => void onLogin(e)}>
          <label>
            Username
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
            />
          </label>
          <label>
            API key (optional)
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(ev) => setApiKey(ev.target.value)}
            />
          </label>
          <label>
            Tenant ID
            <input
              type="text"
              value={tenant}
              onChange={(ev) => setTenant(ev.target.value)}
            />
          </label>
          {error ? <p className="status status-error">{error}</p> : null}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    );
  }

  return (
    <>
      {status?.authRequired && status.authenticated ? (
        <div className="session-bar">
          <span>
            Signed in as <strong>{status.identity || 'operator'}</strong>
            {status.roles?.length ? ` (${status.roles.join(', ')})` : ''}
          </span>
          {status.tenantLocked ? (
            <span>
              Tenant: <strong>{status.sessionTenantId || tenant}</strong>
            </span>
          ) : (
            <span className="tenant-inline">
              Tenant:
              <input
                type="text"
                value={tenant}
                onChange={(ev) => setTenant(ev.target.value)}
                onBlur={() => setTenantId(tenant)}
              />
            </span>
          )}
          <button type="button" className="secondary" onClick={() => void onLogout()}>
            Sign out
          </button>
        </div>
      ) : null}
      {children}
    </>
  );
}
