/**
 * Mastyf Phases 3, 4, & 5 Mutation & Invariant Verification Suite
 *
 * Verifies:
 * - Phase 3: ResourceBypassMutationTest (Tier 1A Canonical Parsing & Pre-Dispatch Authorization)
 * - Phase 4: SubscriptionRevocationMutationTest (Tier 1B Lifecycle & MediatorSecurityDispatch)
 * - Phase 5: WebSocketStartupMutationTest (assertProductionSecurityInvariants parity)
 */

import { describe, it, expect } from 'vitest';
import {
  parseCanonicalResource,
  authorizeResourceRead,
  authorizePromptGet,
} from '../../src/security-os/canonical-resource-guard.js';
import { runMcpPrePipeline } from '../../src/proxy/mcp-request-pipeline.js';
import { gateResourceOrPromptText } from '../../src/utils/resource-prompt-security-gate.js';
import { gateMcpMethodResponse } from '../../src/proxy/mcp-lifecycle-bridge.js';

describe('Phase 3: Tier 1A Resource & Prompt Pre-Dispatch Authorization', () => {
  describe('Canonical URI Parsing & Traversal Detection', () => {
    it('normalizes valid URIs cleanly into canonical components', () => {
      const parsed = parseCanonicalResource('postgres://db.corp.internal:5432/schemas/public?ssl=true&timeout=10');
      expect(parsed.scheme).toBe('postgres');
      expect(parsed.host).toBe('db.corp.internal');
      expect(parsed.port).toBe(5432);
      expect(parsed.canonicalPath).toBe('/schemas/public');
      expect(parsed.query).toEqual({ ssl: 'true', timeout: '10' });
      expect(parsed.hasTraversalAttempt).toBe(false);
      expect(parsed.isDangerousPath).toBe(false);
    });

    it('detects directory traversal sequences in raw and encoded paths', () => {
      const uris = [
        'file:///workspace/../../etc/passwd',
        'file:///workspace/%2e%2e/%2e%2e/etc/shadow',
        'file:///workspace/..%2f..%2fetc/sudoers',
        'file:///workspace/..\\..\\system32\\config\\sam',
        'file:///workspace/foo/bar/../../../root/.ssh/id_rsa',
      ];

      for (const uri of uris) {
        const parsed = parseCanonicalResource(uri);
        expect(parsed.hasTraversalAttempt).toBe(true);
      }
    });

    it('rejects null byte injection attempts', () => {
      const parsed = parseCanonicalResource('file:///workspace/data.txt\0/etc/passwd');
      expect(parsed.hasTraversalAttempt).toBe(true);
      expect(parsed.isDangerousPath).toBe(true);
      expect(parsed.traversalReason).toContain('Null byte injection');
    });

    it('identifies sensitive system file targets even if normalized', () => {
      const dangerous = [
        'file:///etc/passwd',
        'file:///etc/shadow',
        'file:///proc/self/environ',
        'file:///dev/mem',
        'file:///var/run/docker.sock',
        'file:///root/.ssh/authorized_keys',
        'file:///app/.env',
      ];

      for (const uri of dangerous) {
        const parsed = parseCanonicalResource(uri);
        expect(parsed.isDangerousPath).toBe(true);
      }
    });
  });

  describe('Pre-Dispatch Resource Authorization Policy', () => {
    it('blocks directory traversal attempts pre-dispatch with JSON-RPC -32001', () => {
      const res = authorizeResourceRead('file:///workspace/../../etc/passwd');
      expect(res.allowed).toBe(false);
      expect(res.code).toBe(-32001);
      expect(res.reason).toMatch(/traversal/i);
    });

    it('blocks prohibited sensitive system files with -32001', () => {
      const res = authorizeResourceRead('file:///etc/shadow');
      expect(res.allowed).toBe(false);
      expect(res.code).toBe(-32001);
      expect(res.reason).toContain('prohibited sensitive system path');
    });

    it('blocks SSRF targets (cloud metadata and localhost)', () => {
      const awsMetadata = authorizeResourceRead('http://169.254.169.254/latest/meta-data/');
      expect(awsMetadata.allowed).toBe(false);
      expect(awsMetadata.code).toBe(-32001);
      expect(awsMetadata.reason).toContain('SSRF');

      const localhost = authorizeResourceRead('http://127.0.0.1:8080/admin');
      expect(localhost.allowed).toBe(false);
      expect(localhost.code).toBe(-32001);
      expect(localhost.reason).toContain('SSRF');
    });

    it('blocks unauthorized schemes', () => {
      const res = authorizeResourceRead('gopher://evil.corp/1');
      expect(res.allowed).toBe(false);
      expect(res.code).toBe(-32001);
      expect(res.reason).toContain('Unauthorized URI scheme');
    });

    it('allows benign authorized resource paths', () => {
      const res = authorizeResourceRead('file:///workspace/docs/readme.md', {
        allowedPathPrefixes: ['/workspace'],
      });
      expect(res.allowed).toBe(true);
      expect(res.canonicalResource?.canonicalPath).toBe('/workspace/docs/readme.md');
    });
  });

  describe('Pre-Dispatch Prompt Authorization', () => {
    it('rejects prompt names containing path traversal or injection characters', () => {
      expect(authorizePromptGet('../system-prompt').allowed).toBe(false);
      expect(authorizePromptGet('admin/prompts').allowed).toBe(false);
      expect(authorizePromptGet('test\0inject').allowed).toBe(false);
      expect(authorizePromptGet('prompt$eval').allowed).toBe(false);
    });

    it('allows valid prompt identifiers', () => {
      expect(authorizePromptGet('summarize-text').allowed).toBe(true);
      expect(authorizePromptGet('code_refactor_v2').allowed).toBe(true);
    });
  });

  describe('End-to-End Pipeline Pre-Dispatch Gating', () => {
    it('blocks resources/read traversal through runMcpPrePipeline before dispatch', () => {
      const res = runMcpPrePipeline({
        msg: {
          jsonrpc: '2.0',
          id: 42,
          method: 'resources/read',
          params: { uri: 'file:///app/../../etc/passwd' },
        },
        serverName: 'fs-server',
        authenticated: true,
      });

      expect(res.blocked).toBe(true);
      if (res.blocked) {
        expect(res.response.error).toBeDefined();
        const err = res.response.error as { code: number; message: string };
        expect(err.code).toBe(-32001);
        expect(err.message).toContain('traversal');
      }
    });

    it('blocks prompts/get traversal through runMcpPrePipeline before dispatch', () => {
      const res = runMcpPrePipeline({
        msg: {
          jsonrpc: '2.0',
          id: 43,
          method: 'prompts/get',
          params: { name: '../../hidden_prompt' },
        },
        serverName: 'prompt-server',
        authenticated: true,
      });

      expect(res.blocked).toBe(true);
      if (res.blocked) {
        expect(res.response.error).toBeDefined();
        const err = res.response.error as { code: number; message: string };
        expect(err.code).toBe(-32001);
      }
    });

    it('blocks resources/subscribe traversal through runMcpPrePipeline before dispatch', () => {
      const res = runMcpPrePipeline({
        msg: {
          jsonrpc: '2.0',
          id: 44,
          method: 'resources/subscribe',
          params: { uri: 'file:///app/../../etc/passwd' },
        },
        serverName: 'fs-server',
        authenticated: true,
      });

      expect(res.blocked).toBe(true);
      if (res.blocked) {
        const err = res.response.error as { code: number; message: string };
        expect(err.code).toBe(-32001);
        expect(err.message).toContain('traversal');
      }
    });

    it('allows an in-scope resources/subscribe and tracks its response', () => {
      const res = runMcpPrePipeline({
        msg: {
          jsonrpc: '2.0',
          id: 45,
          method: 'resources/subscribe',
          params: { uri: 'file:///workspace/doc.txt' },
        },
        serverName: 'fs-server',
        authenticated: true,
      });

      expect(res.blocked).toBe(false);
      if (!res.blocked) {
        expect(res.trackResponse).toBe(true);
        expect(res.requestMethod).toBe('resources/subscribe');
      }
    });
  });

  describe('resources/subscribe Response DLP', () => {
    it('redacts PII echoed in a subscribe result', () => {
      const orig = process.env.MASTYF_AI_RESPONSE_DLP_MODE;
      process.env.MASTYF_AI_RESPONSE_DLP_MODE = 'redact';
      try {
        const rawResult = {
          subscriptionId: 'sub_1',
          contents: [
            { uri: 'file:///workspace/user.txt', text: 'Contact: Jane Roe, SSN: 987-65-4321' },
          ],
        };

        const gated = gateResourceOrPromptText('resources/subscribe', rawResult);
        expect(gated.blocked).toBe(false);
        const sanitized = gated.sanitized as typeof rawResult;
        expect(sanitized.subscriptionId).toBe('sub_1');
        expect(sanitized.contents[0].text).not.toContain('987-65-4321');
        expect(sanitized.contents[0].text).toContain('[REDACTED:SSN]');
      } finally {
        process.env.MASTYF_AI_RESPONSE_DLP_MODE = orig;
      }
    });

    it('blocks a credential in a subscribe result in block mode', () => {
      const orig = process.env.MASTYF_AI_RESPONSE_DLP_MODE;
      process.env.MASTYF_AI_RESPONSE_DLP_MODE = 'block';
      try {
        const gated = gateResourceOrPromptText('resources/subscribe', {
          contents: [{ uri: 'file:///workspace/creds.txt', text: 'api_key=sk_live_51H8xQ2KZvJ9' }],
        });
        expect(gated.blocked).toBe(true);
      } finally {
        process.env.MASTYF_AI_RESPONSE_DLP_MODE = orig;
      }
    });

    it('does not over-block an ordinary subscribe acknowledgement', () => {
      const gated = gateResourceOrPromptText('resources/subscribe', {
        subscriptionId: 'sub_2',
        uri: 'file:///workspace/notes.md',
        status: 'ACTIVE',
      });
      expect(gated.blocked).toBe(false);
    });

    it('routes a subscribe result through the bridge DLP decision', () => {
      const orig = process.env.MASTYF_AI_RESPONSE_DLP_MODE;
      process.env.MASTYF_AI_RESPONSE_DLP_MODE = 'block';
      try {
        const gated = gateMcpMethodResponse({
          method: 'resources/subscribe',
          result: { contents: [{ uri: 'file:///x', text: 'token=sk_live_51H8xQ2KZvJ9x' }] },
        });
        expect(gated.blocked).toBe(true);
      } finally {
        process.env.MASTYF_AI_RESPONSE_DLP_MODE = orig;
      }
    });
  });

  describe('Post-Dispatch DLP Redaction & Response Filtering', () => {
    it('redacts sensitive credentials and PII from resource contents in redact mode', () => {
      const orig = process.env.MASTYF_AI_RESPONSE_DLP_MODE;
      process.env.MASTYF_AI_RESPONSE_DLP_MODE = 'redact';
      try {
        const rawResult = {
          contents: [
            {
              uri: 'file:///workspace/user.txt',
              text: 'User profile: John Doe, SSN: 123-45-6789, email: john@example.com',
            },
          ],
        };

        const gated = gateResourceOrPromptText('resources/read', rawResult);
        expect(gated.blocked).toBe(false);
        expect(gated.sanitized).toBeDefined();
        const sanitized = gated.sanitized as typeof rawResult;
        expect(sanitized.contents[0].text).toContain('[REDACTED:SSN]');
        expect(sanitized.contents[0].text).not.toContain('123-45-6789');
      } finally {
        process.env.MASTYF_AI_RESPONSE_DLP_MODE = orig;
      }
    });

    it('does not truncate a trailing redaction placeholder', () => {
      const orig = process.env.MASTYF_AI_RESPONSE_DLP_MODE;
      process.env.MASTYF_AI_RESPONSE_DLP_MODE = 'redact';
      try {
        // The placeholder is longer than the value it replaces, so any rewrite
        // that maps offsets from the original text clips the tail.
        const gated = gateResourceOrPromptText('resources/read', {
          contents: [{ uri: 'file:///workspace/u.txt', text: 'Contact: Jane Roe, SSN: 987-65-4321' }],
        });
        const text = (gated.sanitized as { contents: Array<{ text: string }> }).contents[0].text;
        expect(text).toBe('Contact: Jane Roe, SSN: [REDACTED:SSN]');
        expect(text).not.toMatch(/\[REDACTED:[A-Z]*$/);
      } finally {
        process.env.MASTYF_AI_RESPONSE_DLP_MODE = orig;
      }
    });

    it('redacts each content entry independently', () => {
      const orig = process.env.MASTYF_AI_RESPONSE_DLP_MODE;
      process.env.MASTYF_AI_RESPONSE_DLP_MODE = 'redact';
      try {
        const gated = gateResourceOrPromptText('resources/read', {
          contents: [
            { uri: 'file:///a.txt', text: 'first SSN: 111-22-3333' },
            { uri: 'file:///b.txt', text: 'second SSN: 444-55-6666' },
            { uri: 'file:///c.txt', text: 'no sensitive data here' },
          ],
        });
        const contents = (gated.sanitized as { contents: Array<{ text: string }> }).contents;
        expect(contents[0].text).toBe('first SSN: [REDACTED:SSN]');
        expect(contents[1].text).toBe('second SSN: [REDACTED:SSN]');
        expect(contents[2].text).toBe('no sensitive data here');
      } finally {
        process.env.MASTYF_AI_RESPONSE_DLP_MODE = orig;
      }
    });

    it('blocks sensitive credentials and PII from resource contents in block mode', () => {
      const orig = process.env.MASTYF_AI_RESPONSE_DLP_MODE;
      process.env.MASTYF_AI_RESPONSE_DLP_MODE = 'block';
      try {
        const rawResult = {
          contents: [
            {
              uri: 'file:///workspace/user.txt',
              text: 'User profile: John Doe, SSN: 123-45-6789',
            },
          ],
        };

        const gated = gateResourceOrPromptText('resources/read', rawResult);
        expect(gated.blocked).toBe(true);
        expect(gated.reason).toContain('Sensitive data leak prevented');
      } finally {
        process.env.MASTYF_AI_RESPONSE_DLP_MODE = orig;
      }
    });
  });
});

