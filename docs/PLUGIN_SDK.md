# Detector Plugin SDK v3.0

Production detector plugins ship as `@mcp-guardian/plugin-sdk` (monorepo: `packages/plugin-sdk`).

## Quick start

```bash
npm install @mcp-guardian/plugin-sdk
```

```javascript
import { createDetectorPlugin } from '@mcp-guardian/plugin-sdk';

export default createDetectorPlugin({
  name: 'acme-pii-scanner',
  version: '1.0.0',
  onLoad() {
    console.error('[acme] plugin loaded');
  },
  onUnload() {
    console.error('[acme] plugin unloaded');
  },
  scanArguments(text, ctx) {
    if (/ACME_TOKEN_[A-Z0-9]{8}/.test(text)) {
      return [{
        type: 'acme-token',
        location: ctx.location || 'args',
        severity: 'HIGH',
        redacted: 'ACME_TOKEN_[REDACTED]',
        method: 'regex',
      }];
    }
    return [];
  },
});
```

Build to CommonJS/ESM `.js` and enable:

```bash
export GUARDIAN_PLUGINS_ENABLED=true   # default on in v2.7; set false to disable
export GUARDIAN_PLUGIN_PATH=/opt/guardian/plugins
mcp-guardian proxy --policy default-policy.yaml ...
```

## API stability

| Export | Status |
|--------|--------|
| `createDetectorPlugin` | Stable |
| `DetectorPlugin`, `DetectorFinding`, `DetectorScanContext` | Stable |
| `onLoad` / `onUnload` | Stable lifecycle hooks |
| `PLUGIN_SDK_VERSION` | Semver-aligned (`3.3.1`) |

Plugins run **after** built-in `scanForSecrets()` in the secret scanner pipeline.

## Publishing

**npm:** `@mcp-guardian/plugin-sdk` (from `packages/plugin-sdk`). Publish from the monorepo root:

```bash
pnpm --filter @mcp-guardian/plugin-sdk run build
pnpm publish --filter @mcp-guardian/plugin-sdk --access public
```

**Monorepo / fork:** depend via workspace without publishing:

```json
"@mcp-guardian/plugin-sdk": "workspace:*"
```

1. Depend on `@mcp-guardian/plugin-sdk@^3.3.1` (npm) or `workspace:*` (monorepo).
2. Compile plugin to `.js` (Node 18+).
3. Document required env vars in your README.
4. Test with `GUARDIAN_PLUGIN_PATH` in staging before production.

Bundled deployments can call `registerDetectorPlugin()` at startup instead of dynamic import — see [EXTENSIBILITY.md](EXTENSIBILITY.md).

## Enterprise AI learning (related)

Adaptive learning is separate from detector plugins. See quorum, drift, and rollback in:

- `GUARDIAN_AI_ENABLED` (default on)
- `GUARDIAN_AI_AUTO_APPLY` (default off)
- `mcp-guardian ai rollback`
- `src/ai/learning-quorum.ts`, `drift-detector.ts`, `learning-snapshot.ts`
