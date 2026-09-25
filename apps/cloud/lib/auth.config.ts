import type { NextAuthConfig } from 'next-auth';
import { ensureAuthUser } from './ensure-auth-user';
import { configuredOAuthProviders, DEV_AUTH_PROVIDER_ID, DEMO_AUTH_PROVIDER_ID } from './oauth-providers';

export const authConfig = {
  providers: configuredOAuthProviders(),
  pages: { signIn: '/login' },
  trustHost: true,
  // JWT sessions: same token in middleware (edge) and server components (adapter still stores users/accounts).
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    async signIn({ user, account }) {
      if (!user?.id) return false;
      if (
        account?.provider === DEV_AUTH_PROVIDER_ID ||
        account?.provider === DEMO_AUTH_PROVIDER_ID ||
        account?.provider === 'github' ||
        account?.provider === 'google'
      ) {
        await ensureAuthUser({
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        });
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.email = user.email ?? token.email;
        token.name = user.name ?? token.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        if (typeof token.email === 'string') session.user.email = token.email;
        if (typeof token.name === 'string') session.user.name = token.name;
      }
      return session;
    },
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      if (path.startsWith('/dashboard')) {
        return !!auth?.user;
      }
      return true;
    },
  },
} satisfies NextAuthConfig;

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
