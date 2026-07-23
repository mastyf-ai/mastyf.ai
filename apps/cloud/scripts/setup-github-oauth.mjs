#!/usr/bin/env node
/**
 * Interactive helper — add GitHub OAuth credentials to apps/cloud/.env.local
 *
 * Usage: node scripts/setup-github-oauth.mjs
 *    or: pnpm --filter @mastyf_ai/cloud oauth:setup
 */

import { createInterface } from 'node:readline/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env.local');
const CALLBACK = 'http://localhost:3001/api/auth/callback/github';

function upsertEnv(lines, key, value) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const row = `${key}=${value}`;
  if (idx >= 0) lines[idx] = row;
  else lines.push(row);
  return lines;
}

async function main() {
  console.log('\nmastyf.ai Cloud — GitHub OAuth setup\n');
  console.log('1. Open: https://github.com/settings/developers');
  console.log('2. OAuth Apps → New OAuth App');
  console.log(`3. Homepage URL: http://localhost:3001`);
  console.log(`4. Authorization callback URL: ${CALLBACK}`);
  console.log('5. Copy Client ID and generate Client secret\n');

  const rl = createInterface({ input, output });
  const clientId = (await rl.question('GitHub Client ID: ')).trim();
  const clientSecret = (await rl.question('GitHub Client secret: ')).trim();
  rl.close();

  if (!clientId || !clientSecret) {
    console.error('\nBoth Client ID and secret are required.');
    process.exit(1);
  }

  let content = '';
  try {
    content = await readFile(ENV_PATH, 'utf8');
  } catch {
    content = `# Created by oauth:setup
AUTH_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_CLOUD_URL=http://localhost:3001
AUTH_SECRET=
DATABASE_URL=postgresql://localhost:5432/mastyf_ai_cloud
`;
  }

  let lines = content.split('\n').filter((l, i, arr) => !(l === '' && i === arr.length - 1));
  lines = upsertEnv(lines, 'AUTH_GITHUB_ID', clientId);
  lines = upsertEnv(lines, 'AUTH_GITHUB_SECRET', clientSecret);
  if (!lines.some((l) => l.startsWith('AUTH_DEV_LOGIN='))) {
    lines.push('AUTH_DEV_LOGIN=true');
  }

  await writeFile(ENV_PATH, `${lines.join('\n')}\n`, 'utf8');

  console.log(`\nWrote ${ENV_PATH}`);
  console.log('Restart the dev server: cd apps/cloud && pnpm dev');
  console.log('Then open http://localhost:3001/login — you should see Continue with GitHub.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
