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
} from '@/lib/mastyf-ai-api';
import { Button } from './ui/Button';
import { BrandLogo } from './ui/BrandLogo';
import { InitialSetup } from './InitialSetup';
import { AuthSessionContext } from './AuthSessionContext';

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

  useEffect(() => { void refresh(); }, [refresh]);

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
    return (
      <div className="shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <p className="text-sm text-muted">Checking session…</p>
      </div>
    );
  }

  if (status?.setupRequired) {
    return <InitialSetup onComplete={() => void refresh()} />;
  }

  if (!canShowDashboard) {
    return (
      <div className="shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: 400, width: '100%', margin: '0 var(--space-4)' }}>
          <div className="card-body">
            <div style={{ margin: '0 auto 16px', width: 52 }}>
              <BrandLogo size={52} />
            </div>
            <h2 className="card-title" style={{ textAlign: 'center', marginBottom: 4 }}>mastyf.ai</h2>
            <p className="text-sm text-muted" style={{ textAlign: 'center', marginBottom: 20 }}>
              Dashboard authentication required
            </p>

            {error && (
              <div className="banner banner-danger" style={{ marginBottom: 16 }}>
                <div className="banner-content">{error}</div>
              </div>
            )}

            <form onSubmit={(e) => void onLogin(e)}>
              <div style={{ marginBottom: 12 }}>
                <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Username</label>
                <input
                  className="input"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(ev) => setUsername(ev.target.value)}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Password</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>API Key (optional)</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(ev) => setApiKey(ev.target.value)}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Tenant ID</label>
                <input
                  className="input"
                  type="text"
                  value={tenant}
                  onChange={(ev) => setTenant(ev.target.value)}
                />
              </div>
              <Button variant="primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthSessionContext.Provider
      value={{
        status,
        tenant: status?.sessionTenantId || tenant,
        onLogout,
        onRestartSession: () => { void refresh(); },
      }}
    >
      {children}
    </AuthSessionContext.Provider>
  );
}
