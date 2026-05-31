import { describe, it, expect } from 'vitest';
import { createDetectorPlugin, PLUGIN_SDK_VERSION } from '@mcp-guardian/plugin-sdk';
import { registerDetectorPlugin, runDetectorPlugins, clearDetectorPluginsForTests } from '../../src/plugins/detector-plugin.js';

describe('plugin-sdk v3', () => {
  it('exports stable version', () => {
    expect(PLUGIN_SDK_VERSION).toBe('4.0.0');
  });

  it('createDetectorPlugin registers and scans', () => {
    clearDetectorPluginsForTests();
    const plugin = createDetectorPlugin({
      name: 'sdk-test',
      scanArguments(text) {
        return text.includes('SDKTEST') ? [{ type: 'sdk', location: 'x', severity: 'HIGH' }] : [];
      },
    });
    registerDetectorPlugin(plugin);
    const findings = runDetectorPlugins('hello SDKTEST world', {});
    expect(findings.some((f) => f.type === 'sdk')).toBe(true);
    clearDetectorPluginsForTests();
  });
});
