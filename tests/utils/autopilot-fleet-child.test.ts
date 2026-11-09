import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const maybeAutoStart = vi.fn();
const startReportScheduler = vi.fn();
const resumeThreatDiscoveryWatchers = vi.fn();
const startHealthProbeScheduler = vi.fn();

vi.mock('../../src/utils/threat-discovery-scheduler.js', () => ({ maybeAutoStart }));
vi.mock('../../src/utils/report-scheduler.js', () => ({ startReportScheduler }));
vi.mock('../../src/utils/threat-discovery-runner.js', () => ({ resumeThreatDiscoveryWatchers }));
vi.mock('../../src/services/health-probe-scheduler.js', () => ({ startHealthProbeScheduler }));
vi.mock('../../src/utils/autopilot-config.js', () => ({ readAutopilotConfig: () => ({ enabled: true, reportSchedule: 'daily' }) }));

describe('background services and per-server proxies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves research and reports to the parent when this proxy fronts one server', async () => {
    vi.stubEnv('MASTYF_AI_FLEET_CHILD', 'true');
    const { startAutopilotServices } = await import('../../src/utils/autopilot-services.js');
    startAutopilotServices({} as never);
    expect(maybeAutoStart).not.toHaveBeenCalled();
    expect(startReportScheduler).not.toHaveBeenCalled();
    expect(resumeThreatDiscoveryWatchers).not.toHaveBeenCalled();
  });

  it('still starts them in a child that is the host for its app', async () => {
    vi.stubEnv('MASTYF_AI_FLEET_CHILD', 'true');
    vi.stubEnv('MASTYF_AI_AUTOPILOT_HOST', 'true');
    const { startAutopilotServices } = await import('../../src/utils/autopilot-services.js');
    startAutopilotServices({} as never);
    expect(maybeAutoStart).toHaveBeenCalled();
  });

  it('still starts them for a standalone proxy', async () => {
    vi.stubEnv('MASTYF_AI_FLEET_CHILD', 'false');
    const { startAutopilotServices } = await import('../../src/utils/autopilot-services.js');
    startAutopilotServices({} as never);
    expect(maybeAutoStart).toHaveBeenCalled();
  });
});
