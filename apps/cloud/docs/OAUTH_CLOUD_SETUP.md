# OAuth setup for mastyf.ai Cloud

Sign-in uses **NextAuth** with Google and/or GitHub. You need at least one provider configured, plus `AUTH_SECRET` and `DATABASE_URL`.

## 1. Environment variables

Copy `apps/cloud/.env.example` to `apps/cloud/.env.local` and set:

| Variable | Required | Notes |
|----------|----------|--------|
| `AUTH_SECRET` | Yes | `openssl rand -base64 32` |
| `DATABASE_URL` | Yes | Postgres (user accounts are stored here) |
| `AUTH_URL` | Dev | `http://localhost:3001` |
| `NEXT_PUBLIC_APP_URL` | Dev | Same as `AUTH_URL` |
| `AUTH_GITHUB_ID` | One of | GitHub OAuth App client ID |
| `AUTH_GITHUB_SECRET` | One of | GitHub OAuth App client secret |
| `AUTH_GOOGLE_ID` | One of | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | One of | Google OAuth client secret |

Restart the dev server after changing `.env.local`.

## Quick local dev (no OAuth app)

If you only need the cloud console locally, add to `.env.local`:

```bash
AUTH_DEV_LOGIN=true
```

Restart the dev server, open `/login`, and click **Continue as local dev user**. This is disabled in production (`NODE_ENV=production`).

For real GitHub OAuth locally, run:

```bash
pnpm --filter @mastyf_ai/cloud oauth:setup
```

## 2. GitHub OAuth App

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
2. **Homepage URL:** `http://localhost:3001` (or your production URL)
3. **Authorization callback URL:**
   - Local: `http://localhost:3001/api/auth/callback/github`
   - Production: `https://<your-domain>/api/auth/callback/github`
4. Copy **Client ID** → `AUTH_GITHUB_ID`
5. Generate **Client secret** → `AUTH_GITHUB_SECRET`

## 3. Google OAuth (optional)

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth client ID
2. Application type: **Web application**
3. **Authorized redirect URIs:**
   - Local: `http://localhost:3001/api/auth/callback/google`
   - Production: `https://<your-domain>/api/auth/callback/google`
4. Copy client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`

## 4. Vercel (production)

In the Vercel project → **Settings → Environment Variables**, add the same keys for **Production** (and Preview if needed). Set:

- `AUTH_URL` / `NEXT_PUBLIC_APP_URL` to your public site URL (e.g. `https://mastyf-ai-cloud.vercel.app`)
- OAuth callback URLs in GitHub/Google must match that domain

Redeploy after saving env vars.

## 5. Verify

1. `cd apps/cloud && pnpm dev`
2. Open `http://localhost:3001/login`
3. You should see **Continue with GitHub** and/or **Continue with Google**

If buttons are missing, check the terminal for auth errors and confirm all required env vars are set.
