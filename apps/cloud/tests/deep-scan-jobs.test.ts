import { describe, expect, it, vi, afterEach } from 'vitest';

const { enqueueDeepScan, getJob } = vi.hoisted(() => ({
  enqueueDeepScan: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock('@/lib/deep-scan-jobs', () => ({
  deepScanQueueAvailable: () => true,
  enqueueDeepScan,
  getJob,
}));

describe('deep-scan jobs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    enqueueDeepScan.mockReset();
    getJob.mockReset();
  });

  it('enqueueDeepScan is mocked for route tests', async () => {
    enqueueDeepScan.mockResolvedValue({
      id: 'job-1',
      packageName: '@a/b',
      orgId: null,
      status: 'pending',
      resultJson: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    });
    const { enqueueDeepScan: enqueue } = await import('@/lib/deep-scan-jobs');
    const job = await enqueue('@a/b');
    expect(job.id).toBe('job-1');
  });
});
