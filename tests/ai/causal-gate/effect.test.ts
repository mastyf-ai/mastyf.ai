import { describe, expect, it } from 'vitest';
import { classifyEffect, sensitiveArgs } from '../../../src/ai/causal-gate/effect.js';

describe('classifyEffect', () => {
  it.each([
    ['read_file', 'read'],
    ['get_received_emails', 'read'],
    ['GitHubSearchRepositories', 'read'],
    ['git__diff', 'read'],
    ['send_email', 'external_send'],
    ['send_money', 'external_send'],
    ['slack.post_message', 'external_send'],
    ['delete_file', 'irreversible'],
    ['execute_code', 'irreversible'],
    ['terminal__execute', 'irreversible'],
    ['update_role', 'privilege'],
    ['AugustSmartLockGrantGuestAccess', 'privilege'],
    ['create_calendar_event', 'write'],
    ['filesystem__write_file', 'write'],
    ['frobnicate', 'unknown'],
  ])('%s is %s', (tool, effect) => {
    expect(classifyEffect(tool, {})).toBe(effect);
  });

  it('does not let a server call a delete tool read-only', () => {
    expect(classifyEffect('delete_file', {}, { readOnlyHint: true })).toBe('irreversible');
  });

  it('uses hints only to fill gaps or raise risk', () => {
    expect(classifyEffect('frobnicate', {}, { readOnlyHint: true })).toBe('read');
    expect(classifyEffect('read_file', {}, { destructiveHint: true })).toBe('irreversible');
  });

  it('reads the statement in a generic query tool', () => {
    expect(classifyEffect('query_database', { query: 'SELECT * FROM t' })).toBe('read');
    expect(classifyEffect('query_database', { query: ' drop table users' })).toBe('irreversible');
    expect(classifyEffect('query_database', { sql: 'UPDATE t SET a=1' })).toBe('write');
  });
});

describe('sensitiveArgs', () => {
  it('has none for reads', () => {
    expect(sensitiveArgs({ path: '/x' }, 'read')).toEqual([]);
  });

  it('covers targets but not free-form content', () => {
    const paths = sensitiveArgs({ to: ['a'], subject: 's', body: 'b', meta: { host: 'h' } }, 'external_send');
    expect(paths.sort()).toEqual(['meta.host', 'to[0]']);
  });
});
