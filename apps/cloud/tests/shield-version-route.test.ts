import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/v1/download/shield/version/route';

describe('GET /api/v1/download/shield/version', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('tells anyone the current version, with no download link in it', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.version).toBe('string');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(JSON.stringify(body)).not.toMatch(/amazonaws|X-Amz|\.exe|\.dmg/);
    expect(body.downloadPage).toMatch(/\/download$/);
  });

  it('lists only the platforms that are offered', async () => {
    vi.stubEnv('NEXT_PUBLIC_SHIELD_PLATFORMS', 'windows');
    const body = await GET().json();
    expect(body.platforms).toEqual(['windows']);
  });
});
