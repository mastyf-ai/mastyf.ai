import { describe, expect, it } from 'vitest';
import { evaluateSemanticGuards } from '../../src/policy/semantic-guards.js';
import type { CallContext } from '../../src/policy/policy-types.js';

const guard = (sql: string) =>
  evaluateSemanticGuards({ serverName: 's', toolName: 'query', arguments: { sql } } as unknown as CallContext);

describe('SQL guard: bulk reads of sensitive tables are blocked, single-row lookups are not', () => {
  it('allows a column list with an id filter on a sensitive table', () => {
    expect(guard('SELECT id, name FROM customers WHERE id = 42')).toBeNull();
    expect(guard("SELECT email FROM users WHERE username = 'asha'")).toBeNull();
  });

  it('still blocks reading a whole sensitive table', () => {
    expect(guard('SELECT * FROM customers')?.rule).toBe('semantic-sql-guard');
    expect(guard('SELECT id, name FROM customers')?.rule).toBe('semantic-sql-guard');
    expect(guard('SELECT password FROM users')?.rule).toBe('semantic-sql-guard');
  });

  it('still blocks the always-true filters and star selects that dump a table', () => {
    expect(guard('SELECT * FROM customers WHERE id = 42')?.rule).toBe('semantic-sql-guard');
    expect(guard('SELECT id FROM users WHERE 1=1')?.rule).toBe('semantic-sql-guard');
    expect(guard("SELECT id FROM users WHERE id = 1 OR 1=1")?.rule).toBe('semantic-sql-guard');
    expect(guard('SELECT id FROM users WHERE id > 0')?.rule).toBe('semantic-sql-guard');
  });
});
