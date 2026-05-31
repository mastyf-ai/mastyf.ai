import { describe, it, expect } from 'vitest';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { IndustryStandardStore } from '../../src/database/industry-standard-store.js';

describe('IndustryStandardStore (SQLite)', () => {
  it('persists and lists fleet chain events', () => {
    const db = new HistoryDatabase(':memory:');
    const store = new IndustryStandardStore(db);

    store.saveFleetChainEvent({
      globalSessionId: 'agent:test-agent',
      agentId: 'test-agent',
      serverName: 'filesystem',
      toolName: 'read_file',
      eventType: 'tool_call',
      blocked: false,
    });

    const rows = store.listFleetChainEvents('agent:test-agent');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.serverName).toBe('filesystem');
    expect(rows[0]!.toolName).toBe('read_file');
    expect(rows[0]!.agentId).toBe('test-agent');
  });
});
