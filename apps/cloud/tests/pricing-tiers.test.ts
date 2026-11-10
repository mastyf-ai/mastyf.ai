import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAN_FOR_TIER } from '@/components/dashboard/plans';
import { PRICING_TIERS } from '@/components/landing/stats';
import { LICENSE_TIERS } from '@/lib/license-tiers';

const tier = (id: string) => {
  const found = PRICING_TIERS.find((t) => t.id === id);
  if (!found) throw new Error(`no ${id} plan`);
  return found;
};
const text = (id: string) => JSON.stringify(tier(id));

describe('the plans on the site', () => {
  it('are Community, Developer Pro, Team and Custom', () => {
    expect(PRICING_TIERS.map((t) => t.id)).toEqual(['community', 'developer', 'team', 'custom']);
  });

  it('keep Community free', () => {
    expect(tier('community').price).toBe('₹0');
  });

  it('describe Developer Pro as one person on one device, with the offer and the normal price', () => {
    expect(text('developer')).toContain('One person on one device');
    expect(tier('developer').price).toBe('₹999');
    for (const price of ['first 100', '₹1,999', '₹8,999', '₹20,999']) expect(tier('developer').billing).toContain(price);
  });

  it('describe Team as up to 10 people in one workspace', () => {
    expect(text('team')).toContain('Up to 10 people in one workspace');
    expect(tier('team').price).toBe('₹9,999');
    expect(tier('team').billing).toContain('₹1,04,999');
  });

  it('leave Custom without a published price, and offer a way to get in touch', () => {
    expect(tier('custom').price).toBe('Custom');
    expect(tier('custom').shortCta).toBe('Contact us');
    expect(text('custom')).not.toMatch(/₹|lakh|99\.9%|24\/7/);
  });

  it('name Protocol X on both paid plans', () => {
    expect(text('developer')).toContain('Protocol X');
    expect(text('team')).toContain('Protocol X');
  });

  it('do not quote the 4.8µs figure', () => {
    expect(JSON.stringify(PRICING_TIERS)).not.toContain('4.8');
  });

  it('promise Shield only on platforms with a current build', () => {
    expect(text('developer')).toContain('Windows');
    expect(text('developer')).not.toMatch(/macOS|Linux/);
  });
});

describe('the website stays out of team management', () => {
  const file = (name: string) => readFileSync(join(process.cwd(), name), 'utf8');

  it('has no Members page or menu item, because that lives in Shield', () => {
    expect(existsSync(join(process.cwd(), 'app/dashboard/members'))).toBe(false);
    expect(file('components/DashboardNav.tsx')).not.toContain('/dashboard/members');
  });

  it('does not explain adding members in the plan text or docs', () => {
    expect(text('team')).not.toMatch(/Add people|join code|Members page/i);
    expect(file('components/docs/Plans.tsx')).not.toMatch(/Members page|adds people/i);
  });
});

describe('what the plans allow', () => {
  it('gives Developer Pro one user', () => {
    expect(LICENSE_TIERS.pro.maxUsers).toBe(1);
  });

  it('gives Team ten users', () => {
    expect(LICENSE_TIERS.team.maxUsers).toBe(10);
  });

  it('shows contract customers as Custom', () => {
    expect(PLAN_FOR_TIER.enterprise).toEqual({ name: 'Custom', pricingId: 'custom' });
  });
});
