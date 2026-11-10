import { describe, expect, it } from 'vitest';
import {
  generateJoinCode,
  hashJoinCode,
  isValidEmail,
  memberDisplayName,
  normalizeEmail,
  normalizeJoinCode,
  planAllowsSeats,
  seatAvailable,
} from '@/lib/billing/workspace-seats';
import { inviteEmail } from '@/lib/billing/invite-email';

describe('email addresses', () => {
  it('are compared without case or stray spaces', () => {
    expect(normalizeEmail('  Prabhat@Example.COM ')).toBe('prabhat@example.com');
  });

  it.each(['a@b.co', 'first.last+tag@sub.example.in'])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each(['', 'nope', 'a@b', '@b.co', 'a b@c.co', 'a@b.co\nBcc: x@y.co', '<a@b.co>', `${'a'.repeat(260)}@b.co`])('rejects %j', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

describe('join codes', () => {
  it('are short enough to type and do not repeat', () => {
    const codes = new Set(Array.from({ length: 300 }, generateJoinCode));
    expect(codes.size).toBe(300);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it('can be typed in any case, with or without the dash', () => {
    expect(normalizeJoinCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeJoinCode('ABCD 2345')).toBe('ABCD2345');
  });

  it('only work with the email they were sent to', () => {
    const hash = hashJoinCode('prabhat@example.com', 'ABCD-2345');
    expect(hashJoinCode('prabhat@example.com', 'abcd2345')).toBe(hash);
    expect(hashJoinCode('someone@example.com', 'ABCD-2345')).not.toBe(hash);
    expect(hashJoinCode('prabhat@example.com', 'ABCD-2346')).not.toBe(hash);
  });

  it('are stored only as a hash', () => {
    expect(hashJoinCode('prabhat@example.com', 'ABCD-2345')).not.toContain('ABCD');
  });
});

describe('who can have members', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const later = new Date('2026-12-10T00:00:00Z');
  const before = new Date('2026-10-10T00:00:00Z');

  it('needs an active Team or Custom plan', () => {
    expect(planAllowsSeats({ tier: 'team', expiresAt: later }, now)).toBe(true);
    expect(planAllowsSeats({ tier: 'enterprise', expiresAt: null }, now)).toBe(true);
  });

  it.each([
    ['a lapsed Team plan', { tier: 'team', expiresAt: before }],
    ['Developer Pro', { tier: 'pro', expiresAt: later }],
    ['the free plan', { tier: 'free', expiresAt: null }],
    ['no plan at all', null],
  ])('refuses %s', (_label, license) => {
    expect(planAllowsSeats(license, now)).toBe(false);
  });

  it('counts the lead as one of the people', () => {
    expect(seatAvailable(10, 8)).toBe(true);
    expect(seatAvailable(10, 9)).toBe(false);
  });

  it('has no limit when the plan has none', () => {
    expect(seatAvailable(-1, 500)).toBe(true);
  });
});

describe('a member’s name', () => {
  it('is what they typed, tidied', () => {
    expect(memberDisplayName('  Prabhat   Kumar ', 'p@example.com')).toBe('Prabhat Kumar');
  });

  it('falls back to the first part of the email', () => {
    expect(memberDisplayName('', 'prabhat@example.com')).toBe('prabhat');
    expect(memberDisplayName(undefined, 'prabhat@example.com')).toBe('prabhat');
  });

  it('is kept to a sensible length', () => {
    expect(memberDisplayName('x'.repeat(200), 'p@example.com')).toHaveLength(60);
  });
});

describe('the invitation email', () => {
  const mail = inviteEmail({
    to: 'prabhat@example.com',
    code: 'ABCD-2345',
    leadName: 'Ada',
    workspace: 'Acme <script>alert(1)</script>',
    siteUrl: 'https://www.mastyf.ai',
  });

  it('carries the code and how to use it', () => {
    expect(mail.text).toContain('ABCD-2345');
    expect(mail.text).toContain('Join a team');
    expect(mail.html).toContain('ABCD-2345');
  });

  it('links to the download page without putting the code in the link', () => {
    expect(mail.text).toContain('https://www.mastyf.ai/join?email=prabhat%40example.com');
    expect(mail.text).not.toMatch(/https?:\/\/\S*ABCD/);
    expect(mail.html).not.toMatch(/href="[^"]*ABCD/);
  });

  it('says who added them', () => {
    expect(mail.subject).toContain('Ada');
    expect(mail.subject).toContain('Acme');
  });

  it('cannot be used to inject markup', () => {
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('keeps the subject on one line', () => {
    const odd = inviteEmail({ to: 'p@example.com', code: 'ABCD-2345', leadName: 'A\r\nBcc: x@y.co', workspace: 'W', siteUrl: 'https://x' });
    expect(odd.subject).not.toMatch(/[\r\n]/);
  });
});
