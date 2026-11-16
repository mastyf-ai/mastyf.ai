import { describe, expect, it } from 'vitest';
import { evaluateSemanticGuards } from '../../src/policy/semantic-guards.js';
import type { CallContext } from '../../src/policy/policy-types.js';

const guard = (sql: string) =>
  evaluateSemanticGuards({ serverName: 's', toolName: 'query', arguments: { sql } } as unknown as CallContext);

describe('SQL guard: bulk reads of sensitive tables are blocked, single-row lookups are not', () => {
  it('allows a column list with an id filter on a sensitive table', () => {
    expect(guard('SELECT id, name FROM customers WHERE id = 42')).toBeNull();
    expect(guard('SELECT email FROM users WHERE user_id = 7')).toBeNull();
  });

  it('still blocks reading a whole sensitive table', () => {
    expect(guard('SELECT * FROM customers')?.rule).toBe('semantic-sql-guard');
    expect(guard('SELECT id, name FROM customers')?.rule).toBe('semantic-sql-guard');
    expect(guard('SELECT password FROM users')?.rule).toBe('semantic-sql-guard');
  });

  it('does not exempt lookups that are dumps in disguise', () => {
    for (const sql of [
      'SELECT group_concat(password) FROM users WHERE active = 1',
      'SELECT string_agg(email, \',\') FROM customers WHERE tenant = 7',
      'SELECT name, password FROM users WHERE id = 1',
      'SELECT u.name FROM users u JOIN payments p ON p.uid = u.id WHERE u.id = 1',
      'SELECT name FROM customers WHERE id = (SELECT max(id) FROM customers)',
      'SELECT name FROM customers WHERE country = \'IN\'',
      'SELECT token FROM credentials WHERE id = 3',
      'SELECT name FROM customers UNION SELECT api_token FROM users WHERE id = 1',
      'SELECT name FROM customers EXCEPT SELECT name FROM users WHERE id = 1',
      'SELECT user_password FROM users WHERE id = 1',
      'SELECT name, api_token FROM users WHERE id = 1',
      'SELECT name FROM customers WHERE tenant_id = 7',
      'SELECT email FROM users WHERE org_id = 3',
      // MySQL compares a string column to 0 as a number: nearly every row matches.
      'SELECT email, name FROM users WHERE uuid = 0',
      'SELECT email FROM users WHERE user_uuid = 0',
      "SELECT email FROM users WHERE id = '0'",
      'SELECT email FROM users WHERE id = 0',
      "SELECT email FROM users WHERE uuid = ''",
    ]) {
      expect({ sql, rule: guard(sql)?.rule }).toEqual({ sql, rule: 'semantic-sql-guard' });
    }
  });

  it('allows a lookup by a key column', () => {
    expect(guard('SELECT name, email FROM customers WHERE customer_id = 42')).toBeNull();
    expect(guard("SELECT status FROM payments WHERE uuid = 'a1b2'")).toBeNull();
    expect(guard('SELECT c.name AS n FROM customers WHERE c.id = 42')).toBeNull();
  });

  it('still blocks the always-true filters and star selects that dump a table', () => {
    expect(guard('SELECT * FROM customers WHERE id = 42')?.rule).toBe('semantic-sql-guard');
    expect(guard('SELECT id FROM users WHERE 1=1')?.rule).toBe('semantic-sql-guard');
    expect(guard("SELECT id FROM users WHERE id = 1 OR 1=1")?.rule).toBe('semantic-sql-guard');
    expect(guard('SELECT id FROM users WHERE id > 0')?.rule).toBe('semantic-sql-guard');
  });
});
