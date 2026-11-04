/** Every transport has to reach the extension points, so a new transport can't quietly skip them. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('extension wiring', () => {
  it('sees tool lists, resources and prompts on every transport', () => {
    expect(read('src/proxy/lifecycle-assurance-gates.ts')).toContain('observeToolList(');
    expect(read('src/proxy/mcp-request-pipeline.ts')).toContain('observePublishedContent(');
    expect(read('src/proxy/rug-pull-transport.ts')).toContain('onToolsListObserved(');
  });

  it('feeds blocks to the fleet detector', () => {
    expect(read('src/container.ts')).toContain('setExtensionBlockListener(');
  });

  it('sees a result before the checks that can return early', () => {
    const source = read('src/proxy/response-inspection.ts');
    expect(source.indexOf('observeToolResult({')).toBeLessThan(source.indexOf('isResponseScanSkipped()) {'));
  });

  it('sees results on stdio even when response scanning is skipped', () => {
    expect(read('src/proxy/proxy-server.ts')).toMatch(/isResponseScanSkipped\(\)\)[\s\S]{0,120}observeToolResult/);
  });

  it('records streamable-http results under the tenant the check used', () => {
    const source = read('src/proxy/streamable-http-proxy-server.ts');
    const start = source.indexOf("msg.method === 'tools/call' && (upstream as");
    expect(source.slice(start, start + 500)).toContain('_defenseTenantId');
  });

  it('routes all tool responses through the shared inspector', () => {
    for (const file of ['proxy-server', 'http-proxy-server', 'sse-proxy-server', 'streamable-http-proxy-server', 'websocket-proxy-server']) {
      expect(read(`src/proxy/${file}.ts`)).toContain('sharedInspectToolResponse(');
    }
    expect(read('src/proxy/response-inspection.ts')).toContain('observeToolResult(');
    expect(read('src/proxy/response-inspection.ts')).toContain('recordToolOutput(');
  });

  it('passes the session id on the transports that give one to the defense layer', () => {
    for (const file of ['sse-proxy-server', 'streamable-http-proxy-server']) {
      const source = read(`src/proxy/${file}.ts`);
      const start = source.indexOf('sharedInspectToolResponse({');
      expect(source.slice(start, start + 500)).toContain('sessionId');
    }
  });

  it('checks calls in the gates every transport shares', () => {
    expect(read('src/proxy/proxy-post-allow-gates.ts')).toContain('checkToolCall(');
    expect(read('src/proxy/tool-call-defense-orchestrator.ts')).toContain('checkDataFlow(');
    expect(read('src/policy/session-flow-guard.ts')).toContain('checkDataFlow(');
  });

  it('loads extensions before the CLI parses, and starts them before a proxy serves', () => {
    const cli = read('src/cli.ts');
    expect(cli.indexOf('await loadExtensions(program)')).toBeGreaterThan(0);
    expect(cli.indexOf('await loadExtensions(program)')).toBeLessThan(cli.indexOf('program.parse()'));
    expect(cli).toContain('await startExtensions()');
  });
});
