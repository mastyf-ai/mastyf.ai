import Image from 'next/image';
import Link from 'next/link';
import { SignInButtons } from '@/components/SignInButtons';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { auth } from '@/lib/auth';
import { CLOUD_NAME, SITE_NAME } from '@/lib/product-links';
import { oauthProviderStatus } from '@/lib/oauth-providers';
import { SUPPORT_EMAIL } from '@/lib/support';
import { redirect } from 'next/navigation';
import '../landing.css';
import './login.css';

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

const supportHint = `Contact ${SUPPORT_EMAIL} if this persists.`;

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: 'OAuth is misconfigured. Check environment variables on this deployment.',
  AccessDenied: `Access was denied. Try another account or contact ${SUPPORT_EMAIL}.`,
  Verification: 'Sign-in link expired. Try again.',
  OAuthAccountNotLinked:
    'This email is already linked to another sign-in method. Use the same provider you used before.',
  OAuthSignin: 'Could not start OAuth. Try again.',
  OAuthCallback: 'OAuth callback failed. Confirm redirect URIs in Google/GitHub app settings.',
  OAuthCreateAccount: 'Could not create your account. Check database logs.',
  CallbackRouteError: 'Sign-in callback error. Try again.',
  Default: 'Sign-in failed. Try again.',
  ProvisionFailed: `Signed in, but organization setup failed. Try again or contact ${SUPPORT_EMAIL}.`,
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  const params = await searchParams;
  let callbackUrl = params.callbackUrl ?? '/dashboard';
  try {
    const parsed = new URL(callbackUrl, 'http://local');
    if (parsed.pathname.startsWith('/')) {
      callbackUrl = `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    /* keep as-is */
  }
  const errorCode = params.error;
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default)
    : null;

  if (session?.user?.id) {
    redirect(callbackUrl);
  }

  const oauth = oauthProviderStatus();
  const oauthReady = oauth.google || oauth.github || oauth.dev;
  const devSetupNeeded = process.env.NODE_ENV === 'development' && !oauth.github && !oauth.google;

  return (
    <div className="landing login-page">
      <SiteNav session={false} />
      <div className="login-page-main">
        <div className="login-card">
          <Link href="/" className="login-brand">
            <Image src="/logo.png" alt="" width={36} height={36} style={{ borderRadius: 8 }} />
            <strong>{SITE_NAME}</strong>
          </Link>

          <h1>Sign in to {CLOUD_NAME}</h1>
          <p className="login-lead">
            {oauth.github || oauth.google
              ? 'Use Google or GitHub to manage policy, API keys, and fleet settings.'
              : oauth.dev
                ? 'Local dev mode — use the dev account below, or add GitHub OAuth for real sign-in.'
                : 'Free cloud console for MCP policy and fleet management.'}
          </p>

          {errorMessage ? (
            <p className="alert alert-warn" role="alert" style={{ textAlign: 'left', marginBottom: '1rem' }}>
              {errorMessage}
              {errorCode && errorCode !== 'AccessDenied' && errorCode !== 'ProvisionFailed' ? (
                <span className="muted" style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                  {supportHint}
                </span>
              ) : null}
              {errorCode ? (
                <span className="muted" style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                  Code: {errorCode}
                </span>
              ) : null}
            </p>
          ) : null}

          <SignInButtons
            callbackUrl={callbackUrl}
            googleEnabled={oauth.google}
            githubEnabled={oauth.github}
            devEnabled={oauth.dev}
            devSetupNeeded={devSetupNeeded}
          />

          {oauthReady ? (
            <p className="login-alt muted">
              No account needed for{' '}
              <Link href="/certified">security scores</Link>.
            </p>
          ) : null}

          <p className="login-footer-links">
            <Link href="/">Back to home</Link>
          </p>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
