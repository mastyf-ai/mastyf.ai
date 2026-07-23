'use client';

import { GITHUB_DEFAULT_BRANCH, GITHUB_REPO_URL } from '@/lib/github-links';
import { DEV_AUTH_PROVIDER_ID } from '@/lib/oauth-providers';
import { SITE_NAME } from '@/lib/product-links';
import { signIn } from 'next-auth/react';

const OAUTH_SETUP_DOC = `${GITHUB_REPO_URL}/blob/${GITHUB_DEFAULT_BRANCH}/apps/cloud/docs/OAUTH_CLOUD_SETUP.md`;

type Props = {
  callbackUrl?: string;
  googleEnabled?: boolean;
  githubEnabled?: boolean;
  devEnabled?: boolean;
  /** True when running locally without OAuth env vars — show setup hint for developers. */
  devSetupNeeded?: boolean;
};

export function SignInButtons({
  callbackUrl = '/dashboard',
  googleEnabled = false,
  githubEnabled = false,
  devEnabled = false,
  devSetupNeeded = false,
}: Props) {
  const anyProvider = googleEnabled || githubEnabled || devEnabled;

  if (!anyProvider) {
    return (
      <>
        <div className="login-no-auth">
          <p>
            <strong>Cloud sign-in is not available right now.</strong> You can still use{' '}
            <a href="/certified">security scores</a> and trust badges without an account.
          </p>
          {devSetupNeeded ? (
            <p>
              <strong>Local development:</strong> run{' '}
              <code>pnpm --filter @mastyf_ai/cloud oauth:setup</code> or add GitHub/Google OAuth to{' '}
              <code>apps/cloud/.env.local</code>. See the{' '}
              <a href={OAUTH_SETUP_DOC}>OAuth setup guide</a>.
            </p>
          ) : (
            <p>
              The cloud console requires Google or GitHub sign-in once OAuth is configured on this
              deployment.
            </p>
          )}
        </div>
        <p className="login-alt muted">
          Self-hosting? Clone{' '}
          <a href={GITHUB_REPO_URL} rel="noopener noreferrer">
            {SITE_NAME} on GitHub
          </a>{' '}
          .
        </p>
      </>
    );
  }

  return (
    <div className="signin-buttons">
      {devEnabled ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => signIn(DEV_AUTH_PROVIDER_ID, { callbackUrl })}
        >
          Continue as local dev user
        </button>
      ) : null}
      {githubEnabled ? (
        <button
          type="button"
          className="btn btn-github"
          onClick={() => signIn('github', { callbackUrl })}
        >
          Continue with GitHub
        </button>
      ) : null}
      {googleEnabled ? (
        <button
          type="button"
          className="btn btn-google"
          onClick={() => signIn('google', { callbackUrl })}
        >
          Continue with Google
        </button>
      ) : null}
      {devEnabled && !githubEnabled && !googleEnabled ? (
        <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0 0', textAlign: 'left' }}>
          Dev-only sign-in (<code>AUTH_DEV_LOGIN=true</code>). For real OAuth, run{' '}
          <code>pnpm --filter @mastyf_ai/cloud oauth:setup</code>.
        </p>
      ) : null}
    </div>
  );
}
