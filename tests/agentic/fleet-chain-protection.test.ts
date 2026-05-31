import { describe, it, expect } from 'vitest';
import { resolveGlobalSessionId, fleetChainBlockConfidenceThreshold } from '../../src/utils/global-session-id.js';
import { FleetChainDetector } from '../../src/agentic/cross-chain/fleet-chain-detector.js';
import { IndustryStandardStore } from '../../src/database/industry-standard-store.js';
import { HistoryDatabase } from '../../src/database/history-db.js';

describe('global session id (A1)', () => {
  it('prefers x-guardian-global-session header', () => {
    const id = resolveGlobalSessionId({
      requestId: 'req-1',
      agentId: 'agent-a',
      headers: { 'x-guardian-global-session': 'fleet-sess-99' },
    });
    expect(id).toBe('fleet-sess-99');
  });

  it('combines agentId and mcpSessionId when no header', () => {
    const id = resolveGlobalSessionId({
      requestId: 'req-1',
      agentId: 'agent-a',
      mcpSessionId: 'mcp-sess-1',
    });
    expect(id).toBe('agent:agent-a:mcp:mcp-sess-1');
  });

  it('uses agentId alone before requestId fallback', () => {
    expect(resolveGlobalSessionId({ requestId: 'req-1', agentId: 'agent-a' })).toBe('agent:agent-a');
    expect(resolveGlobalSessionId({ requestId: 'req-1' })).toBe('req:req-1');
  });
});

describe('fleet chain blocking (A1)', () => {
  it('blocks when cross-server chain confidence exceeds threshold', () => {
    const detector = new FleetChainDetector();
    const session = 'agent:test-agent';
    detector.record({ globalSessionId: session, agentId: 'test-agent', serverName: 'srv-a', toolName: 'read_file' });
    const alert = detector.record({ globalSessionId: session, agentId: 'test-agent', serverName: 'srv-b', toolName: 'http_request' });
    expect(alert).not.toBeNull();
    expect(alert!.confidence).toBeGreaterThanOrEqual(fleetChainBlockConfidenceThreshold());
  });

  it('hydrates session events from DB for cross-restart correlation', () => {
    const db = new HistoryDatabase(':memory:');
    const store = new IndustryStandardStore(db);

    store.saveFleetChainEvent({
      globalSessionId: 'agent:db-agent',
      agentId: 'db-agent',
      serverName: 'filesystem',
      toolName: 'read_file',
      eventType: 'tool_call',
      blocked: false,
    });

    const detector = new FleetChainDetector(store);
    const alert = detector.record({
      globalSessionId: 'agent:db-agent',
      agentId: 'db-agent',
      serverName: 'webhook',
      toolName: 'http_request',
    });
    expect(alert).not.toBeNull();
    expect(alert!.servers.length).toBeGreaterThanOrEqual(2);

    const persisted = store.listFleetChainEvents('agent:db-agent');
    expect(persisted.length).toBeGreaterThanOrEqual(2);
  });
});
