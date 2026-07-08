'use client';

import { useState } from 'react';
import { submitAuthSetup } from '@/lib/auth-admin-api';
import { Button } from './ui/Button';
import { BrandLogo } from './ui/BrandLogo';

type Props = {
  onComplete: () => void;
};

export function InitialSetup({ onComplete }: Props) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await submitAuthSetup({ username, email, displayName, password });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ maxWidth: 440, width: '100%', margin: '0 var(--space-4)' }}>
        <div className="card-body">
          <div style={{ margin: '0 auto 16px', width: 52 }}>
            <BrandLogo size={52} />
          </div>
          <h2 className="card-title" style={{ textAlign: 'center', marginBottom: 4 }}>Welcome to mastyf.ai</h2>
          <p className="text-sm text-muted" style={{ textAlign: 'center', marginBottom: 20 }}>
            No administrator account exists yet. Create the first Admin account to finish setting up your
            dashboard. This screen will not appear again once setup is complete.
          </p>

          {error && (
            <div className="banner banner-danger" style={{ marginBottom: 16 }}>
              <div className="banner-content">{error}</div>
            </div>
          )}

          <form onSubmit={(e) => void onSubmit(e)}>
            <div style={{ marginBottom: 12 }}>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>
                Username
              </label>
              <input
                className="input"
                type="text"
                autoComplete="username"
                required
                minLength={3}
                value={username}
                onChange={(ev) => setUsername(ev.target.value)}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>
                Display name
              </label>
              <input
                className="input"
                type="text"
                required
                value={displayName}
                onChange={(ev) => setDisplayName(ev.target.value)}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>
                Email
              </label>
              <input
                className="input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>
                Password
              </label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>
                Confirm password
              </label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={confirmPassword}
                onChange={(ev) => setConfirmPassword(ev.target.value)}
              />
            </div>
            <p className="text-xs text-muted" style={{ marginBottom: 16 }}>
              At least 12 characters, including uppercase, lowercase, a number, and a symbol.
            </p>
            <Button variant="primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
              {submitting ? 'Creating administrator…' : 'Create Administrator Account'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
