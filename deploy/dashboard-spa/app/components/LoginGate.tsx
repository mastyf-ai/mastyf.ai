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
import { changeOwnPassword, fetchCurrentUser } from '@/lib/auth-admin-api';
import { InitialSetup } from './InitialSetup';
import { DashboardShell } from './DashboardShell';
import { AuthFrame, FindYourKey } from './auth/AuthFrame';
import { AuthSessionContext } from './AuthSessionContext';

type Props = {
  children: ReactNode;
  onAuthenticated?: () => void;
  /** Called whenever the session state is known: true once the dashboard may load data. */
  onSession?: (signedIn: boolean) => void;
};

export function LoginGate({ children, onAuthenticated, onSession }: Props) {
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

  useEffect(() => {
    if (status) onSession?.(!!canShowDashboard && !status.setupRequired);
  }, [status, canShowDashboard, onSession]);

  const [method, setMethod] = useState<'key' | 'password'>('key');
  /** Set when the account must pick a new password (after an admin reset). Holds the password just used. */
  const [mustChange, setMustChange] = useState<{ current: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');

  // Also catch it on a fresh page load with an existing session.
  useEffect(() => {
    if (!status?.authenticated || mustChange) return;
    void fetchCurrentUser().then((me) => {
      if (me?.user?.mustChangePassword) setMustChange({ current: '' });
    });
  }, [status?.authenticated, mustChange]);

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!mustChange) return;
    if (newPassword !== newPassword2) {
      setError('The two new passwords are different.');
      return;
    }
    setSubmitting(true);
    try {
      await changeOwnPassword(mustChange.current || password, newPassword);
      setMustChange(null);
      setNewPassword('');
      setNewPassword2('');
      setPassword('');
      await refresh();
      onAuthenticated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setSubmitting(false);
    }
  };

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (method === 'key' && !apiKey.trim()) {
      setError('Paste your API key first.');
      return;
    }
    if (method === 'password' && (!username.trim() || !password)) {
      setError('Enter your username and password.');
      return;
    }
    setSubmitting(true);
    setTenantId(tenant);
    const csrf = await fetchCsrfToken();
    const result = await loginDashboard(
      method === 'key'
        ? { api_key: apiKey.trim(), csrfToken: csrf.csrfToken }
        : { username: username.trim(), password, csrfToken: csrf.csrfToken },
    );
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Sign-in failed. Check what you entered and try again.');
      return;
    }
    setApiKey('');
    if (result.mustChangePassword && method === 'password') {
      setMustChange({ current: password });
      await refresh();
      return;
    }
    setPassword('');
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
    return <DashboardShell status="Checking your session" />;
  }

  if (mustChange && status?.authenticated) {
    return (
      <AuthFrame
        title="Choose a new password"
        intro={<p>Your password was reset by an administrator. Pick a new one to continue; the temporary password stops working.</p>}
      >
        {error && <div className="auth-error" role="alert">{error}</div>}
        <form className="auth-form" onSubmit={(e) => void onChangePassword(e)}>
          {!mustChange.current && (
            <label className="auth-field">
              <span>Temporary password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                autoFocus
              />
            </label>
          )}
          <label className="auth-field">
            <span>New password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(ev) => setNewPassword(ev.target.value)}
              autoFocus={!!mustChange.current}
            />
          </label>
          <p className="auth-hint">At least 12 characters, with an uppercase and a lowercase letter, a number and a symbol.</p>
          <label className="auth-field">
            <span>Type the new password again</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword2}
              onChange={(ev) => setNewPassword2(ev.target.value)}
            />
          </label>
          <Button variant="primary" type="submit" disabled={submitting} className="auth-submit">
            {submitting ? 'Saving' : 'Save new password'}
          </Button>
        </form>
      </AuthFrame>
    );
  }

  if (status?.setupRequired) {
    return <InitialSetup onComplete={() => { void refresh().then(() => onAuthenticated?.()); }} />;
  }

  if (!canShowDashboard) {
    return (
      <AuthFrame
        title="Sign in to Mastyf"
        intro={<p>This dashboard runs on your computer. Sign in with your API key, or with a username and password an administrator made for you.</p>}
      >
        <div className="auth-switch" role="tablist" aria-label="Sign-in method">
          <button
            type="button"
            role="tab"
            aria-selected={method === 'key'}
            className={`auth-switch-tab${method === 'key' ? ' active' : ''}`}
            onClick={() => { setMethod('key'); setError(''); }}
          >
            API key
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === 'password'}
            className={`auth-switch-tab${method === 'password' ? ' active' : ''}`}
            onClick={() => { setMethod('password'); setError(''); }}
          >
            Username and password
          </button>
        </div>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <form className="auth-form" onSubmit={(e) => void onLogin(e)}>
          {method === 'key' ? (
            <label className="auth-field">
              <span>API key</span>
              <input
                className="input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste the key here"
                value={apiKey}
                onChange={(ev) => setApiKey(ev.target.value)}
                autoFocus
              />
            </label>
          ) : (
            <>
              <label className="auth-field">
                <span>Username or email</span>
                <input
                  className="input"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(ev) => setUsername(ev.target.value)}
                  autoFocus
                />
              </label>
              <label className="auth-field">
                <span>Password</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                />
              </label>
            </>
          )}

          <details className="auth-more">
            <summary>Signing in to another workspace?</summary>
            <label className="auth-field">
              <span>Workspace (tenant) ID</span>
              <input className="input" type="text" value={tenant} onChange={(ev) => setTenant(ev.target.value)} />
            </label>
          </details>

          <Button variant="primary" type="submit" disabled={submitting} className="auth-submit">
            {submitting ? 'Signing in' : 'Sign in'}
          </Button>
        </form>

        {method === 'key' && <FindYourKey />}
      </AuthFrame>
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
