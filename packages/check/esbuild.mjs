// Builds dist/mastyf-check.cjs: one file that runs with Node alone. Paid and agentic modules are
// swapped for the same do-nothing stubs the tests use; server-only libraries are swapped for a
// stand-in that loads but refuses use; the default policy and the threat-intel signatures are
// embedded, since a single-file program has no repository next to it.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubFor } from './aliases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const policy = readFileSync(resolve(here, 'check-default-policy.yaml'), 'utf8');
const signatures = readFileSync(resolve(repo, 'config/threat-intel-signatures.json'), 'utf8');

/** Paid and agentic modules on the check path → the free stubs. */
const stubs = {
  name: 'free-stubs',
  setup(b) {
    b.onResolve({ filter: /^\./ }, (args) => {
      const stub = stubFor(resolve(args.resolveDir, args.path));
      return stub ? { path: stub } : undefined;
    });
  },
};

/** Libraries the free service never uses (databases, tracing exporters, cloud SDKs, native addons). */
const SERVER_ONLY = [
  /^better-sqlite3$/,
  /^sqlite3$/,
  /^pg(?:-native)?$/,
  /^mysql2$/,
  /^ioredis$/,
  /^redis$/,
  /^tiktoken(?:\/.*)?$/,
  /^@aws-sdk\//,
  /^@google-cloud\//,
  /^kafkajs$/,
  /^onnxruntime-node$/,
  /^@xenova\/transformers$/,
  /^fsevents$/,
  /^@opentelemetry\/(?!api$)/,
];
const unavailable = {
  name: 'server-only',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      SERVER_ONLY.some((re) => re.test(args.path)) ? { path: resolve(here, 'stubs/unavailable.cjs') } : undefined,
    );
  },
};

/** threat-intel-guard reads its signatures from the repository; give it the embedded copy. */
const embedSignatures = {
  name: 'embed-signatures',
  setup(b) {
    b.onLoad({ filter: /threat-intel-guard\.ts$/ }, (args) => {
      let code = readFileSync(args.path, 'utf8');
      const reads = [
        ['existsSync(SIGNATURES_PATH)', 'true'],
        ["readFileSync(SIGNATURES_PATH, 'utf-8')", JSON.stringify(signatures)],
      ];
      for (const [from, to] of reads) {
        if (!code.includes(from)) throw new Error(`embed-signatures: "${from}" not found in threat-intel-guard.ts; update the build`);
        code = code.split(from).join(to);
      }
      return { contents: code, loader: 'ts' };
    });
  },
};

await build({
  entryPoints: [resolve(here, 'src/bin.ts')],
  outfile: resolve(here, 'dist/mastyf-check.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  plugins: [stubs, unavailable, embedSignatures],
  define: {
    __CHECK_DEFAULT_POLICY__: JSON.stringify(policy),
    'import.meta.url': '__importMetaUrl',
  },
  banner: { js: '#!/usr/bin/env node\nconst __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('built dist/mastyf-check.cjs');
