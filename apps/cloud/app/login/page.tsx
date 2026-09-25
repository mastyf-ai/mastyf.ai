import Image from 'next/image';
import Link from 'next/link';
import { SignInButtons } from '@/components/SignInButtons';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { auth } from '@/lib/auth';
import { CLOUD_NAME, SITE_NAME } from '@/lib/product-links';
import { oauthProviderStatus } from '@/lib/oauth-providers';
import { SUPPORT_EMAIL } from '@/lib/support';
import { signOutAction } from '@/app/actions';
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

          <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-left">
            <p className="text-xs text-amber-200">
              💡 <strong>Looking to download Mastyf Shield?</strong> No account or login is required. You can download and activate Shield directly.
            </p>
            <Link href="/download" className="text-xs text-amber-400 font-semibold underline mt-1 inline-block">
              Go to Mastyf Shield Download →
            </Link>
          </div>

          {session?.user?.id ? (
            <div className="card p-3 mb-4 bg-slate-800/80 border-slate-700 text-center">
              <p className="text-xs text-slate-300 mb-2">
                Active session detected ({session.user.email || session.user.name || 'Demo Session'}).
              </p>
              <div className="flex items-center justify-center gap-3">
                <form action={signOutAction}>
                  <button type="submit" className="btn btn-secondary btn-sm text-xs py-1.5 px-3">
                    Sign Out / Clear Session
                  </button>
                </form>
                <Link href="/download" className="btn btn-primary btn-sm text-xs py-1.5 px-3">
                  Download Shield →
                </Link>
              </div>
            </div>
          ) : null}

          <h1>Sign in to Enterprise Control Plane</h1>
          <p className="login-lead">
            {oauth.github || oauth.google
              ? 'Use Google or GitHub to manage policy, API keys, and fleet settings.'
              : oauth.dev
                ? 'Local dev mode — use the dev account below, or add GitHub OAuth for real sign-in.'
                : 'Enterprise control plane for centralized policy and fleet governance.'}
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
