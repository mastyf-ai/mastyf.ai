import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import type { Provider } from 'next-auth/providers';

export const DEV_AUTH_PROVIDER_ID = 'dev-local';

const DEV_USER_ID = 'dev-local-mastyf-user';
const DEV_USER_EMAIL = 'dev@localhost.mastyf.ai';

function devLoginEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.AUTH_DEV_LOGIN === 'true';
}

function devCredentialsProvider(): Provider | null {
  if (!devLoginEnabled()) return null;

  return Credentials({
    id: DEV_AUTH_PROVIDER_ID,
    name: 'Local dev account',
    credentials: {},
    authorize: async () => ({
      id: DEV_USER_ID,
      name: 'Local Dev',
      email: DEV_USER_EMAIL,
    }),
  });
}

export function configuredOAuthProviders(): Provider[] {
  const providers: Provider[] = [];

  const googleId = process.env.AUTH_GOOGLE_ID?.trim();
  const googleSecret = process.env.AUTH_GOOGLE_SECRET?.trim();
  if (googleId && googleSecret) {
    providers.push(
      Google({
        clientId: googleId,
        clientSecret: googleSecret,
      }),
    );
  }

  const githubId = process.env.AUTH_GITHUB_ID?.trim();
  const githubSecret = process.env.AUTH_GITHUB_SECRET?.trim();
  if (githubId && githubSecret) {
    providers.push(
      GitHub({
        clientId: githubId,
        clientSecret: githubSecret,
        allowDangerousEmailAccountLinking: true,
        authorization: { params: { scope: 'read:user user:email' } },
      }),
    );
  }

  const dev = devCredentialsProvider();
  if (dev) providers.push(dev);

  return providers;
}

export function oauthProviderStatus(): { google: boolean; github: boolean; dev: boolean } {
  return {
    google: !!(process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim()),
    github: !!(process.env.AUTH_GITHUB_ID?.trim() && process.env.AUTH_GITHUB_SECRET?.trim()),
    dev: devLoginEnabled(),
  };
}
