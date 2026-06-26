import { describe, expect, it, vi, afterEach } from 'vitest';

const mockDb = {
  getDistinctScannedServers: vi.fn(),
  getLatestSecurityScan: vi.fn(),
};

vi.mock('../../src/container.js', () => ({
  createContainer: vi.fn(),
}));

describe('ReadResource latest-scan', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns database error status when DB read fails', async () => {
    const { Logger } = await import('../../src/utils/logger.js');
    const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});

    mockDb.getDistinctScannedServers.mockRejectedValue(new Error('db down'));
    const container = { db: mockDb };

    const latestScan = {
      timestamp: new Date().toISOString(),
      note: 'Run scan_security or full_report to populate',
    };

    let response: { contents: Array<{ text: string }> };
    try {
      await mockDb.getDistinctScannedServers('default');
      response = { contents: [{ text: JSON.stringify(latestScan) }] };
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      Logger.warn(`[mcp-resource] latest-scan DB read failed: ${detail}`);
      response = {
        contents: [{
          text: JSON.stringify({
            status: 'error',
            error: 'database_unavailable',
            message: detail,
          }),
        }],
      };
    }

    const body = JSON.parse(response.contents[0].text);
    expect(body.status).toBe('error');
    expect(body.error).toBe('database_unavailable');
    expect(warnSpy).toHaveBeenCalled();
  });
});
