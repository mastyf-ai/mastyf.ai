'use client';

import { useState } from 'react';
import { submitAuthSetup } from '@/lib/auth-admin-api';
import { Button } from './ui/Button';
import { AuthFrame, FindYourKey } from './auth/AuthFrame';

type Props = {
  onComplete: () => void;
};

/** The password rules the server enforces by default (src/auth/password.ts, DEFAULT_PASSWORD_POLICY). */
function passwordProblems(pw: string, username: string, email: string): string[] {
  const out: string[] = [];
  const lower = pw.toLowerCase();
  const user = username.trim().toLowerCase();
  const local = email.trim().split('@')[0]?.toLowerCase() ?? '';
  if (pw.length < 12) out.push('at least 12 characters');
  if (!/[A-Z]/.test(pw)) out.push('an uppercase letter');
  if (!/[a-z]/.test(pw)) out.push('a lowercase letter');
  if (!/[0-9]/.test(pw)) out.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) out.push('a symbol');
  if (user.length >= 3 && lower.includes(user)) out.push('NOT:your username');
  else if (local.length >= 3 && lower.includes(local)) out.push('NOT:the first part of your email');
  return out;
}

/** "Your password needs a number. It must not contain your username." */
function describeProblems(problems: string[], lead: string): string {
  const needs = problems.filter((p) => !p.startsWith('NOT:'));
  const forbids = problems.filter((p) => p.startsWith('NOT:')).map((p) => p.slice(4));
  const parts: string[] = [];
  if (needs.length) parts.push(`${lead} ${needs.join(', ')}.`);
  if (forbids.length) parts.push(`It must not contain ${forbids.join(' or ')}.`);
  return parts.join(' ');
}

/** First run: no account exists yet. The API key proves the person here is the one who installed Mastyf. */
export function InitialSetup({ onComplete }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const missing = password ? passwordProblems(password, username, email) : [];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!apiKey.trim()) {
      setError('Paste your API key. It shows you are the person who installed Mastyf on this computer.');
      return;
    }
    if (missing.length) {
      setError(describeProblems(missing, 'Your password needs'));
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords are different.');
      return;
    }
    setSubmitting(true);
    try {
      await submitAuthSetup({
        username: username.trim(),
        email: email.trim(),
        displayName: displayName.trim() || username.trim(),
        password,
        api_key: apiKey.trim(),
      });
      setApiKey('');
      setPassword('');
      setConfirmPassword('');
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame
      title="Set up your dashboard"
      intro={
        <p>
          This is the first time the dashboard has run here. Create your administrator account; you will use it, or
          the API key, to sign in from now on. This screen only appears once.
        </p>
      }
    >
      {error && <div className="auth-error" role="alert">{error}</div>}

      <form className="auth-form" onSubmit={(e) => void onSubmit(e)}>
        <label className="auth-field">
          <span>API key</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the key here"
            required
            value={apiKey}
            onChange={(ev) => setApiKey(ev.target.value)}
            autoFocus
          />
        </label>
        <FindYourKey />

        <div className="auth-row">
          <label className="auth-field">
            <span>Username</span>
            <input
              className="input"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Your name</span>
            <input
              className="input"
              type="text"
              autoComplete="name"
              value={displayName}
              placeholder={username || 'Shown in the header'}
              onChange={(ev) => setDisplayName(ev.target.value)}
            />
          </label>
        </div>
        <label className="auth-field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            aria-describedby="pw-rule"
          />
        </label>
        <p id="pw-rule" className={`auth-hint${password && missing.length === 0 ? ' ok' : ''}`}>
          {password
            ? missing.length
              ? describeProblems(missing, 'Still needs')
              : 'Strong enough.'
            : 'At least 12 characters, with an uppercase and a lowercase letter, a number and a symbol, and not containing your username.'}
        </p>
        <label className="auth-field">
          <span>Type the password again</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(ev) => setConfirmPassword(ev.target.value)}
          />
        </label>
        <Button variant="primary" type="submit" disabled={submitting} className="auth-submit">
          {submitting ? 'Creating your account' : 'Create account and sign in'}
        </Button>
      </form>
    </AuthFrame>
  );
}
