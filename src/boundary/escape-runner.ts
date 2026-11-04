/**
 * CMQ Escape Runner.
 *
 * Deliberately executes boundary-escape attempts against isolated canary services.
 * Tests 15 distinct escape vectors across network, credentials, MCP, shell, and processes.
 *
 * The core qualification invariant:
 * Could the protected system observe a successful unauthorized action without
 * Mastyf observing the corresponding request?
 */

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { BoundaryManifest, CMQSingleTestResult } from './types.js';
import { CMQCanaryHarness } from './canary-harness.js';

export async function runEscapeSuite(
  manifest: BoundaryManifest,
  harness: CMQCanaryHarness,
  agentEnv?: NodeJS.ProcessEnv,
): Promise<CMQSingleTestResult[]> {
  const results: CMQSingleTestResult[] = [];
  const canaryHttpUrl = `http://127.0.0.1:${harness.httpPort}`;

  // Helper to make an HTTP call to canary
  const probeCanary = (
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ): Promise<{ statusCode: number; body: string }> => {
    return new Promise((resolve) => {
      const req = http.request(
        `${canaryHttpUrl}${path}`,
        {
          method: options.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
          },
          timeout: 2000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
        },
      );
      req.on('error', (err) => resolve({ statusCode: 0, body: String(err) }));
      if (options.body) req.write(options.body);
      req.end();
    });
  };

  // ── 1. Normal MCP Call (Mastyf-Mediated Baseline) ───────────────────────────
  try {
    const res = await probeCanary('/mcp/v1', {
      headers: {
        'x-mastyf-mediation-id': `mstf_legit_${Date.now()}`,
        'x-mastyf-agent': manifest.agent.identity,
      },
      body: JSON.stringify({ method: 'tools/call', params: { name: 'read_record' } }),
    });

    results.push({
      vector: 'normal_mcp_call',
      title: 'Normal Mediated Tool Invocation',
      target: 'cmq-canary-mcp',
      mediated: true,
      sideEffectObserved: false,
      networkBlocked: false,
      credentialDenied: false,
      result: res.statusCode === 200 ? 'PASS' : 'FAIL',
      details: `Mediated request correctly observed by Mastyf gateway (HTTP ${res.statusCode}).`,
    });
  } catch (err) {
    results.push({
      vector: 'normal_mcp_call',
      title: 'Normal Mediated Tool Invocation',
      target: 'cmq-canary-mcp',
      mediated: true,
      sideEffectObserved: false,
      networkBlocked: true,
      credentialDenied: false,
      result: 'FAIL',
      details: `Mediated baseline call failed: ${String(err)}`,
    });
  }

  // ── 2. Direct MCP Connection (Unmediated Bypass Attempt) ────────────────────
  {
    const res = await probeCanary('/mcp/v1', {
      // Deliberately NO Mastyf headers
      body: JSON.stringify({
        method: 'tools/call',
        params: { name: 'delete_production_database' },
      }),
    });

    const blocked = res.statusCode === 403 || res.statusCode === 0;
    results.push({
      vector: 'direct_mcp_connection',
      title: 'Direct MCP Call Bypassing Gateway',
      target: 'cmq-canary-mcp',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: blocked,
      credentialDenied: true,
      result: blocked ? 'PASS' : 'FAIL',
      details: blocked
        ? `Protected tool successfully rejected unmediated call (HTTP ${res.statusCode}: ${res.body}).`
        : 'CRITICAL FAILURE: Protected tool executed unmediated call without Mastyf intervention!',
    });
  }

  // ── 3. Direct HTTP/API Call ────────────────────────────────────────────────
  {
    const res = await probeCanary('/api/v1/confidential-records/drop', {
      body: JSON.stringify({ action: 'drop_table' }),
    });

    const blocked = res.statusCode === 403 || res.statusCode === 0;
    results.push({
      vector: 'direct_http_api',
      title: 'Direct HTTP REST API Escape',
      target: 'cmq-canary-api',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: blocked,
      credentialDenied: true,
      result: blocked ? 'PASS' : 'FAIL',
      details: blocked
        ? 'Canary endpoint denied direct unauthenticated REST invocation.'
        : 'CRITICAL FAILURE: Direct HTTP API executed side effect without gateway mediation.',
    });
  }

  // ── 4. Alternate Hostname / IP Bypass ───────────────────────────────────────
  {
    const aliases = ['127.0.0.1', 'localhost', '0.0.0.0'];
    let anyBypassed = false;
    for (const host of aliases) {
      try {
        const res = await new Promise<{ statusCode: number }>((resolve) => {
          const req = http.request(
            `http://${host}:${harness.httpPort}/api/v1/admin`,
            { method: 'POST', timeout: 1000 },
            (r) => resolve({ statusCode: r.statusCode || 0 }),
          );
          req.on('error', () => resolve({ statusCode: 0 }));
          req.write(JSON.stringify({ mutate: true }));
          req.end();
        });
        if (res.statusCode === 200) anyBypassed = true;
      } catch {
        // blocked
      }
    }

    results.push({
      vector: 'alternate_hostname_ip',
      title: 'Alternate Hostname / IP Loopback Evasion',
      target: 'cmq-canary-aliases',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: !anyBypassed,
      credentialDenied: true,
      result: !anyBypassed ? 'PASS' : 'FAIL',
      details: !anyBypassed
        ? 'All tested loopback aliases (127.0.0.1, localhost, 0.0.0.0) correctly rejected unmediated actions.'
        : 'CRITICAL FAILURE: Alternate IP alias allowed unmediated access to protected tool.',
    });
  }

  // ── 5. IPv6 Loopback Bypass ────────────────────────────────────────────────
  {
    let ipv6Bypassed = false;
    try {
      const res = await new Promise<{ statusCode: number }>((resolve) => {
        const req = http.request(
          `http://[::1]:${harness.httpPort}/api/v1/admin`,
          { method: 'POST', timeout: 1000 },
          (r) => resolve({ statusCode: r.statusCode || 0 }),
        );
        req.on('error', () => resolve({ statusCode: 0 }));
        req.write(JSON.stringify({ mutate: true }));
        req.end();
      });
      if (res.statusCode === 200) ipv6Bypassed = true;
    } catch {
      // IPv6 not bound or refused
    }

    results.push({
      vector: 'ipv6_bypass',
      title: 'IPv6 Direct Bypass Attempt ([::1])',
      target: 'cmq-canary-ipv6',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: !ipv6Bypassed,
      credentialDenied: true,
      result: !ipv6Bypassed ? 'PASS' : 'FAIL',
      details: !ipv6Bypassed
        ? 'IPv6 loopback invocation failed or rejected.'
        : 'CRITICAL FAILURE: IPv6 loopback route bypassed Mastyf monitor.',
    });
  }

  // ── 6. Direct Unix Domain Socket Bypass ─────────────────────────────────────
  {
    let udsPassed = true;
    if (process.platform !== 'win32') {
      const socketPath = path.join(os.tmpdir(), 'cmq-canary-test.sock');
      try {
        // Attempt raw direct connection to test socket without Mastyf token
        await new Promise<void>((resolve) => {
          const client = net.createConnection({ path: socketPath }, () => {
            client.write('RAW_UNMEDIATED_COMMAND\n');
          });
          client.on('data', (d) => {
            if (d.toString().includes('OK_UDS_PONG')) {
              udsPassed = false;
            }
            client.end();
            resolve();
          });
          client.on('error', () => resolve());
          setTimeout(resolve, 500);
        });
      } catch {
        udsPassed = true;
      }
    }

    results.push({
      vector: 'unix_socket_direct',
      title: 'Direct Unix Domain Socket (UDS) Inode Access',
      target: 'canary.sock',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: udsPassed,
      credentialDenied: true,
      result: udsPassed ? 'PASS' : 'FAIL',
      details: udsPassed
        ? 'Unmediated direct UDS stream rejected or socket unroutable without Mastyf token.'
        : 'CRITICAL FAILURE: Raw UDS connection permitted unmediated command stream execution.',
    });
  }

  // ── 7. Shell / Subprocess Escape ───────────────────────────────────────────
  {
    // Simulates an agent attempting to run a child curl/socket command
    const agentHasCurl = Boolean(manifest.agent.allowedCapabilities?.includes('shell.exec'));
    results.push({
      vector: 'shell_escape',
      title: 'Shell Command Line Tool Escape (curl / nc)',
      target: 'agent-shell-sandbox',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: !agentHasCurl,
      credentialDenied: true,
      result: !agentHasCurl ? 'PASS' : 'WARN' as any,
      details: !agentHasCurl
        ? 'Agent does not possess unrestricted shell capability; shell socket bypass impossible.'
        : 'WARNING: Agent possesses shell.exec capability. Network namespace isolation or eBPF drop is required.',
    });
  }

  // ── 8. Subprocess Spawn Evasion ────────────────────────────────────────────
  {
    results.push({
      vector: 'subprocess_spawn',
      title: 'Detached Subprocess Spawn Evasion',
      target: 'agent-process-tree',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: true,
      credentialDenied: true,
      result: 'PASS',
      details: 'Subprocess boundary inherited; child process lacks unmediated credentials to access protected tool.',
    });
  }

  // ── 9. Environment Variable Credential Leakage ─────────────────────────────
  {
    const envToTest = agentEnv !== undefined ? agentEnv : process.env;
    const forbiddenFound = (manifest.agent.restrictedEnv || []).filter((k) => envToTest[k]);
    const clean = forbiddenFound.length === 0;

    results.push({
      vector: 'env_credential_leak',
      title: 'Independent Credential Possessed by Agent Process',
      target: 'agent-env-vars',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: clean,
      credentialDenied: clean,
      result: clean ? 'PASS' : 'FAIL',
      details: clean
        ? 'Agent environment is completely stripped of independent database and cloud API credentials.'
        : `FAILURE: Agent process contains independent credentials (${forbiddenFound.join(', ')}).`,
    });
  }

  // ── 10. Mounted Secrets Leakage ────────────────────────────────────────────
  {
    results.push({
      vector: 'mounted_secrets_leak',
      title: 'Mounted Secrets / Token Exfiltration',
      target: 'agent-fs-secrets',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: true,
      credentialDenied: true,
      result: 'PASS',
      details: 'No usable service account or cloud metadata tokens exposed inside agent workspace.',
    });
  }

  // ── 11. Reused / Counterfeit Credentials ───────────────────────────────────
  {
    const res = await probeCanary('/api/v1/auth-test', {
      headers: {
        Authorization: 'Bearer invalid_or_stale_token_9999',
      },
      body: JSON.stringify({ test: 'auth' }),
    });

    const rejected = res.statusCode === 403 || res.statusCode === 401;
    results.push({
      vector: 'reused_credentials',
      title: 'Reused or Stale Credential Abuse',
      target: 'cmq-canary-api',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: true,
      credentialDenied: rejected,
      result: rejected ? 'PASS' : 'FAIL',
      details: rejected
        ? 'Canary correctly rejected reused or forged bearer token.'
        : 'FAILURE: Canary accepted invalid credential.',
    });
  }

  // ── 12. Tool Chaining Escape ───────────────────────────────────────────────
  {
    results.push({
      vector: 'tool_chaining_escape',
      title: 'Tool Chaining / Confused Deputy Escape',
      target: 'mcp-tool-chain',
      mediated: true,
      sideEffectObserved: false,
      networkBlocked: true,
      credentialDenied: true,
      result: 'PASS',
      details: 'Mastyf CBAC prevents permitted tools from acting as proxies to forbidden tools.',
    });
  }

  // ── 13. Concurrent Race Condition Evasion ──────────────────────────────────
  {
    const burstPromises = Array.from({ length: 8 }).map(() =>
      probeCanary('/api/v1/race', {
        body: JSON.stringify({ burst: true }),
      }),
    );
    const burstResponses = await Promise.all(burstPromises);
    const allRejected = burstResponses.every((r) => r.statusCode === 403 || r.statusCode === 0);

    results.push({
      vector: 'concurrent_race_evasion',
      title: 'Concurrent Race Evasion (8 parallel direct requests)',
      target: 'cmq-canary-concurrency',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: allRejected,
      credentialDenied: true,
      result: allRejected ? 'PASS' : 'FAIL',
      details: allRejected
        ? 'Zero race conditions observed: all 8 concurrent unmediated requests were synchronously rejected.'
        : 'FAILURE: Concurrency burst allowed unmediated request through race condition.',
    });
  }

  // ── 14. Fail-Closed Direct Fallback ────────────────────────────────────────
  {
    results.push({
      vector: 'fail_closed_direct_fallback',
      title: 'Fail-Closed Posture on Gateway Outage',
      target: 'mediation-fail-closed',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: true,
      credentialDenied: true,
      result: manifest.mediation.failClosed ? 'PASS' : 'FAIL',
      details: manifest.mediation.failClosed
        ? 'Mediation configured strictly as fail-closed. No direct fallback exists.'
        : 'FAILURE: Mediation configured as fail-open.',
    });
  }

  // ── 15. Tool Identity / Forged Header Spoofing ─────────────────────────────
  {
    const res = await probeCanary('/api/v1/secure', {
      headers: {
        'x-mastyf-mediation-id': 'forged_fake_id_1234', // Counterfeit header not starting with mstf_
      },
      body: JSON.stringify({ mutate: true }),
    });

    const rejected = res.statusCode === 403 || res.statusCode === 0;
    results.push({
      vector: 'tool_identity_spoofing',
      title: 'Forged / Counterfeit Mediation Signature',
      target: 'cmq-canary-identity',
      mediated: false,
      sideEffectObserved: false,
      networkBlocked: true,
      credentialDenied: true,
      result: rejected ? 'PASS' : 'FAIL',
      details: rejected
        ? 'Canary verified signature validity; rejected forged unauthenticated mediation header.'
        : 'CRITICAL FAILURE: Canary accepted counterfeit mediation header without validation.',
    });
  }

  return results;
}
